const fetch = require('node-fetch');
const logging = require('./logging');
const cardanoSerialization = require("@emurgo/cardano-serialization-lib-nodejs");
const GlobalConfig = require('./models/GlobalConfig')
const BlockchainMonitoring = require("./models/BlockchainMonitoring");
const BlockchainTransaction = require("./models/BlockchainTransaction");

let isUpdatingConfirmedTxIndex = false
let confirmedTxId = 0;
let confirmedBlockId = 0;

const debugTiming = false

exports.confirmedTxId = function () {
    return confirmedTxId
};
exports.confirmedBlockId = function () {
    return confirmedBlockId
};

/**
 * Checks the status of the node
 */
const checkNodeStatus = async (host) => {
    if (debugTiming) { console.time('checkNodeStatus') }

    let host2 = host || process.env.CARDANO_API_URL
    const response = await fetch(host2+'/api/status', {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {
            'secret': process.env.CARDANO_API_SECRET,
            'Content-Type': 'application/json'
        },
    });
    const result = await response.json()
    logging.info('Cardano', `Node   Status  -  Epoch: ${result.epoch}, Block: ${result.block}, Slot: ${result.slot}, Sync: ${result.syncProgress}%`)
    if (debugTiming) { console.timeEnd('checkNodeStatus') }

    return result
}
exports.checkNodeStatus = checkNodeStatus

/**
 * Checks the status of DB Sync
 */
const checkDbSyncStatus = async (host) => {
    if (debugTiming) { console.time('checkDbSyncStatus') }

    let host2 = host || process.env.CARDANO_DB_URL
    const blockResponse = await fetch(host2+'/block?order=id.desc&limit=1', {
        insecureHTTPParser: true
    });
    const blockData = await blockResponse.json();
    const block = blockData[0];
    const firstBlock = new Date('2017-09-23 21:44:51')
    const blockDate = new Date(block.time)
    const now = new Date()
    const behindSec = (now.getTime()-blockDate.getTime())/1000
    let behind = behindSec+' sec'
    if (behindSec > 60) {behind = (behindSec/60).toFixed() + ' min'}
    if (behindSec/60 > 60) {behind = (behindSec/60/60).toFixed()+'h'}
    if (behindSec/60/60 > 24) {behind = (behindSec/60/60/24).toFixed(2)+' days'}
    if (debugTiming) { console.timeEnd('checkDbSyncStatus') }
    logging.info('Cardano', `DBSync Status  -  Epoch: ${block.epoch_no}, Block: ${block.block_no}, Slot: ${block.slot_no}, Sync: ${(((blockDate.getTime()-firstBlock.getTime())/(now.getTime()-firstBlock.getTime()))*100).toFixed(2)}%, Behind: ${behind}`)
}
exports.checkDbSyncStatus = checkDbSyncStatus

/**
 * Updates the lastQueryTxId of the blockchain monitoring objects. When switching to a new DB Sync instance this functions must be executed before staring the service agin.
 */
const synchronizeWithDbSync = async (host, shouldUpdateTransactionIds) => {
    let CARDANO_DB_URL = host || process.env.CARDANO_DB_URL
    const guaranteedBlockId = 9729700
    const guaranteedTxId = 81401000

    // Update confirmed tx id
    let confirmations = 1
    // Get the newest block id
    const blockResponse = await fetch(CARDANO_DB_URL+'/block?select=id,block_no&id=gt.'+guaranteedBlockId+'&order=block_no.desc.nullslast&limit='+(confirmations+1), {insecureHTTPParser: true});
    //const blockResponse = await fetch(process.env.CARDANO_DB_URL+'/block?select=id,block_no&id=gt.'+guaranteedBlockId+'&order=block_no.desc.nullslast&limit='+(confirmations+1), {insecureHTTPParser: true});
    const blockData = await blockResponse.json();
    const belowBlockId = blockData[blockData.length - 1].id
    const belowBlockNumber = blockData[blockData.length - 1].block_no
    if (belowBlockId == null) {
        isUpdatingConfirmedTxIndex = false
        throw 'Could not get block_id confirmation limit'
    }

    // Get the id of the last transaction in this block
    const belowTxIdResponse = await fetch(CARDANO_DB_URL+'/tx?select=id&id=gt.'+guaranteedTxId+'&block_id=lte.'+belowBlockId+'&order=id.desc.nullslast&limit=1', {insecureHTTPParser: true});
    //const belowTxIdResponse = await fetch(process.env.CARDANO_DB_URL+'/tx?select=id&id=gt.'+guaranteedTxId+'&block_id=lte.'+belowBlockId+'&order=id.desc.nullslast&limit=1', {insecureHTTPParser: true});
    const belowTxIdData = await belowTxIdResponse.json();
    const belowTxId = belowTxIdData[0].id
    if (belowTxId == null) {
        isUpdatingConfirmedTxIndex = false
        throw 'Could not get tx_id confirmation limit'
    }
    confirmedTxId = belowTxId
    confirmedBlockId = belowBlockNumber

    console.log('Considering all transactions until block_no '+belowBlockNumber+' and tx_id '+belowTxId+' as confirmed ('+confirmations+' block confirmations)')

    // Update last confirmed tx of the monitoring objects
    const objects = await BlockchainMonitoring.find()
    console.log(`Fetched ${objects.length} monitoring objects`)
    for (const object of objects) {
        const transaction = await BlockchainTransaction.findOne({receiverAddress: object.address}).sort({transactionId: -1}).exec()
        if (transaction == null) {
           // console.log(`Address: ${object.address}, Hash: n/a, LastQuery: ${object.lastQueryTxId}, TxId: n/a, DbSyncTxId: n/a - NO REGISTERED TRANSACTION`)
            continue
        }

        // Get the transaction
        const dbSyncTransactionResponse = await fetch(CARDANO_DB_URL+'/tx?hash=eq.'+'\\x'+transaction.hash+'&id=lte.'+confirmedTxId+'&limit=1', {
            insecureHTTPParser: true
        });
        const dbSyncTransactionData = await dbSyncTransactionResponse.json();
        const dbSyncTransaction = dbSyncTransactionData[0];
        if (dbSyncTransaction == null) {
            console.log(`Address: ${object.address}, Hash: ${transaction.hash}, TxId: ${transaction.transactionId}, DbSyncTxId: n/a, LastQuery: ${object.lastQueryTxId} - NO DB SYNC TRANSACTION`)
            continue
        }

        // Test output
        if (shouldUpdateTransactionIds !== true) {
            if (dbSyncTransaction.id !== transaction.transactionId) {
                console.log(`Address: ${object.address}, Hash: ${transaction.hash}, TxId: ${transaction.transactionId}, DbSyncTxId: ${dbSyncTransaction.id}, LastQuery: ${object.lastQueryTxId} - NOT MATCHING`)
            } else {
                console.log(`Address: ${object.address}, Hash: ${transaction.hash}, TxId: ${transaction.transactionId}, DbSyncTxId: ${dbSyncTransaction.id}, LastQuery: ${object.lastQueryTxId}`)
            }
        }

        // Update lastQueryTxId with id from the new db sync instance
        if (shouldUpdateTransactionIds === true) {
            object.lastQueryTxId = dbSyncTransaction.id
            await object.save()
            console.log(`Updated last query transaction id of monitor ${object.id} to ${dbSyncTransaction.id}`)
        }
    }

    if (shouldUpdateTransactionIds !== true) {
        return
    }

    // Update tx id of every registered transaction
    const transactions = await BlockchainTransaction.find().exec()
    console.log(`Fetched ${transactions.length} transactions`)
    for (const transaction of transactions) {

        // Get the db sync transaction
        const dbSyncTransactionResponse = await fetch(CARDANO_DB_URL+'/tx?hash=eq.'+'\\x'+transaction.hash+'&id=lte.'+confirmedTxId+'&limit=1', {
            insecureHTTPParser: true
        });
        const dbSyncTransactionData = await dbSyncTransactionResponse.json();
        const dbSyncTransaction = dbSyncTransactionData[0];
        if (dbSyncTransaction == null) {
            console.log(`Could not find db sync transaction `+transaction.hash)
            continue
        }
        transaction.transactionId = dbSyncTransaction.id
        await transaction.save()
        console.log(`Updated transaction id of transaction ${transaction.hash} to ${dbSyncTransaction.id}`)
    }
}
exports.synchronizeWithDbSync = synchronizeWithDbSync


/**
 * Updates the confirmed transaction index. All transactions prior this will be considered as confirmed.
 */
async function updateConfirmedTxIndex() {
    if (debugTiming) { console.time('updateConfirmedTxIndex') }

    const guaranteedBlockId = 9729700
    const guaranteedTxId = 81401000

    if (isUpdatingConfirmedTxIndex) {
        return
    }
    isUpdatingConfirmedTxIndex = true

    let confirmations = 1
    // Get the newest block id
    const blockResponse = await fetch(process.env.CARDANO_DB_URL+'/block?select=id,block_no&id=gt.'+guaranteedBlockId+'&order=block_no.desc.nullslast&limit='+(confirmations+1), {insecureHTTPParser: true});
    const blockData = await blockResponse.json();
    const belowBlockId = blockData[blockData.length - 1].id
    const belowBlockNumber = blockData[blockData.length - 1].block_no
    if (belowBlockId == null) {
        isUpdatingConfirmedTxIndex = false
        throw 'Could not get block_id confirmation limit'
    }

    // Get the id of the last transaction in this block
    const belowTxIdResponse = await fetch(process.env.CARDANO_DB_URL+'/tx?select=id&id=gt.'+guaranteedTxId+'&block_id=lte.'+belowBlockId+'&order=id.desc.nullslast&limit=1', {insecureHTTPParser: true});
    const belowTxIdData = await belowTxIdResponse.json();
    const belowTxId = belowTxIdData[0].id
    if (belowTxId == null) {
        isUpdatingConfirmedTxIndex = false
        throw 'Could not get tx_id confirmation limit'
    }
    confirmedTxId = belowTxId
    confirmedBlockId = belowBlockNumber

    await GlobalConfig.findOneAndUpdate({_id: '61f06d24573fec4ea0deecdf'}, {lastConfirmedTxId: belowTxId})

    isUpdatingConfirmedTxIndex = false

    if (debugTiming) { console.timeEnd('updateConfirmedTxIndex') }

    //logging.info('Cardano', 'Considering all transactions until block_no '+belowBlockNumber+' and tx_id '+belowTxId+' as confirmed ('+confirmations+' block confirmations)', true)
}
exports.updateConfirmedTxIndex = updateConfirmedTxIndex;

/**
 * Checks for all pending transactions if they have been completed
 */
const checkPendingTransactions = async () => {
    if (debugTiming) { console.time('checkPendingTransactions') }

    const pendingTxs = await BlockchainTransaction.find({$or: [{status: 'PENDING'}, {status: 'PENDING_REFUND'}]})
    for (const pendingTx of pendingTxs) {
        if (pendingTx.refundHash != null) {
            const tx = await queryTransaction(pendingTx.refundHash)
            if (tx.success === true) {
                logging.info('Cardano', `Transaction ${pendingTx.refundHash} confirmed`)
                pendingTx.status = 'REFUNDED'
                await pendingTx.save()
            }
        } else if (pendingTx.actionHash) {
            const tx = await queryTransaction(pendingTx.actionHash)
            if (tx.success === true) {
                logging.info('Cardano', `Transaction ${pendingTx.actionHash} confirmed`)
                pendingTx.status = 'COMPLETED'
                await pendingTx.save()
            }
        } else {
            logging.error('Cardano', 'Could not check pending transaction '+pendingTx.hash)
            pendingTx.status = 'INVALID'
            await pendingTx.save()
        }
    }

    if (debugTiming) { console.timeEnd('checkPendingTransactions') }
}
exports.checkPendingTransactions = checkPendingTransactions

/**
 * Checks the active BlockchainMonitoring addresses for new payments and saves them as BlockchainTransaction.
 */
const checkForTransactions = async (priority) => {
    if (debugTiming) { console.time('checkForTransactions') }

    // Fetch the monitoring objects
    const objects = await BlockchainMonitoring.find({active: true, priority: priority, project: {$ne: null}})
    for (const object of objects) {
        // In each round query up to 10 transactions for each address
        for (let i = 0; i < 100; i++) {
            // Storing the current confirmed tx id
            // Query the next tx for this address
            const result = await queryAndSaveNextTransaction(object)
            if (result === false) {
                // Count up zero queries
                object.zeroQueries = object.zeroQueries+1
                // Updating confirmed tx id to prevent double fetching in the next run
                object.lastQueryTxId = confirmedTxId
                break
            } else {
                // Prioritize this address
                object.zeroQueries = 0
                object.priority = 1
                // Updating confirmed tx id to prevent double fetching in the next run
                object.lastQueryTxId = result
            }
        }
        // Update priority class
        if (object.zeroQueries > 5760 && object.zeroQueries <= 20160) {
            object.priority = 2
        }
        object.lastQuery = new Date()
        await object.save()
    }

    if (debugTiming) { console.timeEnd('checkForTransactions') }

}
exports.checkForTransactions = checkForTransactions

/**
 * Queries the next transaction for an address and saves it to the database.
 */
const queryAndSaveNextTransaction = async (monitor) => {
    if (debugTiming) { console.time('queryAndSaveNextTransaction'+monitor.id) }

    let address = monitor.address
    let project = monitor.project
    let lastQueryTxId = monitor.lastQueryTxId || 1

    // Determine the last handled transaction id
    let lastTxId = 1
    let firstTransactionForAddress = false
    let lastTransaction = await BlockchainTransaction.findOne({receiverAddress: address, project: project}).sort({transactionId: -1})
    if (lastTransaction != null) {
        lastTxId = lastTransaction.transactionId;
    }
    if (lastQueryTxId > lastTxId) {
        lastTxId = lastQueryTxId
    }

    // TODO: Fetch the tx id of the hash again as it could have changed over different db-sync installations

    // Fetch the next transaction in row
    const data = await queryNextTransaction(address, lastTxId)
    if (data == null) {
        return false
    }
    if (data.info != null) {
        logging.error(project, 'data.info == null')
        return false
    }
    let value = 0
    for (const o of data.output) {
        if (o.address === address) {
            value += o.value
        }
    }
    let status = 'OPEN'
    if (address === data.input[0].address || firstTransactionForAddress) {
        status = 'INTERN'
    }

    let message = undefined
    if (data.message != null && data.message.length > 0) {
        if (data.message[0].json.msg != null && data.message[0].json.msg.length > 0) {
            message = data.message[0].json.msg[0]
        }
    }

    let logProject = project

    const check = await BlockchainTransaction.findOne({hash: data.transaction.hash.replace('\\x', '')})
    if (check != null) {
        logging.info(logProject, 'Transaction '+data.transaction.hash.replace('\\x', '')+ ' already registered')
        return data.transaction.id
    }

    const object = new BlockchainTransaction({
        hash: data.transaction.hash.replace('\\x', ''),
        transactionId: data.transaction.id,
        project: project,
        receiverAddress: address,
        senderAddress: data.input[0].address,
        value: value,
        nativeTokens: data.outputNativeTokens,
        message: message,
        status: status,
        input: data.input,
        output: data.output,
        inputRef: data.inputRef,
        validContract: data.transaction.valid_contract,
        blockId: data.transaction.block_id,
        blockIndex: data.transaction.block_index
    })
    let stakeAddr = calculateStakeAddress(data.input[0].address)
    if (stakeAddr != null) {
        object.senderStakeAddress = stakeAddr
    }
    await object.save();

    /*
    // Confirm pending transactions
    if (status === 'INTERN') {
        const pendingTxs = await BlockchainTransaction.find({actionHash: object.hash})
        for (const pendingTx of pendingTxs) {
            pendingTx.status = 'COMPLETED'
            await pendingTx.save()
        }
    }*/

    if (debugTiming) { console.timeEnd('queryAndSaveNextTransaction'+monitor.id) }

    if (status === 'OPEN') {
        logging.info(logProject, `🟢 New Transaction, Address: ${address}, Hash: ${data.transaction.hash.replace('\\x', '')}, Value: ${value/1000000}₳`)
    } else if (firstTransactionForAddress) {
        logging.info(logProject, `🟢 New Initial Transaction, Address: ${address}, Hash: ${data.transaction.hash.replace('\\x', '')}, Value: ${value/1000000}₳`)
    } else {
        logging.info(logProject, `🟢 New Intern Transaction, Address: ${address}, Hash: ${data.transaction.hash.replace('\\x', '')}, Value: ${value/1000000}₳`)
    }
    return data.transaction.id

}


/**
 *  Queries a confirmed transaction above a given id for a given address
 */
async function queryNextTransaction(address, aboveTxId) {
    //if (debugTiming) { console.time('queryNextTransaction'+address) }

    //logging.info('Cardano', 'Querying address '+address+' in tx_id range ['+aboveTxId+'...'+confirmedTxId+']')

    // Query the id of the next transaction matching the address in the output
    const txIdResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_out?address=eq.'+address+'&tx_id=gt.'+aboveTxId+'&tx_id=lte.'+confirmedTxId+'&order=tx_id&limit=1', {
        insecureHTTPParser: true
    });
    const txIdData = await txIdResponse.json();
    if (txIdData.length === 0) {
        // There are no recent transactions to handle
        return null
    }

    // Get the transaction id
    const tx_id = txIdData[0]['tx_id'];
    if (tx_id == null) {
        console.log(txIdData)
        throw 'Could not find tx_id in response'
    }

    // Get the transaction
    const txResponse = await fetch(process.env.CARDANO_DB_URL+'/tx?id=eq.'+tx_id+'&limit=1', {
        insecureHTTPParser: true
    });
    const txData = await txResponse.json();
    const transaction = txData[0];
    if (transaction == null) {
        throw 'Could not find transaction for id'
    }

    // Get the transaction outputs
    const txOutputResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_out?tx_id=eq.'+tx_id, {
        insecureHTTPParser: true
    });
    const txOutputData = await txOutputResponse.json();

    // Get the transaction input reference
    const txInputObjectResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_in?tx_in_id=eq.'+tx_id, {
        insecureHTTPParser: true
    });
    const txInputObjectData = await txInputObjectResponse.json();

    // Note: Currently only fetching one tx input.

    if (txInputObjectData.length > 1) {
        //console.log('[INFO] More than one tx input')
    }

    const tx_out_index = txInputObjectData[0]['tx_out_index'];
    const tx_out_id = txInputObjectData[0]['tx_out_id'];

    // Get the transaction inputs
    const txInputResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_out?tx_id=eq.'+tx_out_id+'&index=eq.'+tx_out_index, {
        insecureHTTPParser: true
    });
    const txInputData = await txInputResponse.json();

    // Get native tokens included in the transaction
    let outputNativeTokens = []
    const multiAssetsTxOutIdObj = txOutputData.find(e => e.address === address)
    if (multiAssetsTxOutIdObj != null) {
        // Fetch multi asset tx output
        const multiAssetOutputsResponse = await fetch(process.env.CARDANO_DB_URL+'/ma_tx_out?tx_out_id=eq.'+multiAssetsTxOutIdObj.id, {
            insecureHTTPParser: true
        });
        const multiAssetOutputs = await multiAssetOutputsResponse.json();
        for (const multiAssetOutput of multiAssetOutputs) {
            // Fetch details of multi assets
            const multiAssetResponse = await fetch(process.env.CARDANO_DB_URL+'/multi_asset?id=eq.'+multiAssetOutput.ident, {
                insecureHTTPParser: true
            });
            const multiAsset = await multiAssetResponse.json();
            outputNativeTokens.push({
                policy: multiAsset[0].policy.replace('\\x', ''),
                assetNameHex: multiAsset[0].name.replace('\\x', ''),
                assetName: hex2a(multiAsset[0].name.replace('\\x', '')),
                fingerprint: multiAsset[0].fingerprint.replace('\\x', ''),
                quantity: multiAssetOutput.quantity
            })
        }
    }

    // Get transaction message
    const messageResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_metadata?key=eq.674&tx_id=eq.'+tx_id+'&limit=1', {
        insecureHTTPParser: true
    });
    const messageData = await messageResponse.json();
    //if (debugTiming) { console.timeEnd('queryNextTransaction'+address) }

    return {
        transaction: transaction,
        input: txInputData,
        output: txOutputData,
        outputNativeTokens: outputNativeTokens,
        inputRef: txInputObjectData,
        transactionId: tx_id,
        message: messageData
    }
}
exports.queryNextTransaction = queryNextTransaction;

function hex2a(hexx) {
    const hex = hexx.toString();//force conversion
    let str = '';
    for (let i = 0; i < hex.length; i += 2)
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

/**
 * Queries a transaction with a given hash (inputs and outputs not included)
 */
async function queryTransaction(hash) {
    if (debugTiming) { console.time('queryTransaction') }

    //logging.info('Cardano', 'Querying next transactions above tx_id '+aboveTxId+' and below tx_id '+confirmedTxId+' for address '+address)

    // Get the transaction
    const txResponse = await fetch(process.env.CARDANO_DB_URL+'/tx?hash=eq.'+'\\x'+hash+'&id=lte.'+confirmedTxId+'&limit=1', {
        insecureHTTPParser: true
    });
    const txData = await txResponse.json();
    const transaction = txData[0];

    if (debugTiming) { console.timeEnd('queryTransaction') }
    if (transaction == null) {
        return {
            success: false,
        }
    } else {
        return {
            success: true,
            transaction: transaction,
        }
    }
}
exports.queryTransaction = queryTransaction;

/**
 * Queries the payment address of the wallets last delegation transaction.
 * This ensures to get a valid payment address for a stake key and prevents franken address exploits.
 */
async function queryLastDelegationPaymentAddress(stakeKey) {
    const stakeAddressResponse = await fetch(process.env.CARDANO_DB_URL+'/stake_address?view=eq.'+stakeKey+'&limit=1', {
        insecureHTTPParser: true
    });
    const stakeAddressData = await stakeAddressResponse.json();
    const stakeAddress = stakeAddressData[0];
    if (stakeAddress == null) {
        logging.error('Cardano',`Could not query last delegation payment address for ${stakeKey}. stakeAddress == null`)
        return {
            success: false
        }
    }

    const delegationResponse = await fetch(process.env.CARDANO_DB_URL+'/delegation?addr_id=eq.'+stakeAddress.id+'&order=tx_id.desc&limit=1', {
        insecureHTTPParser: true
    });
    const delegationData = await delegationResponse.json();
    const delegation = delegationData[0];
    if (delegation == null) {
        logging.error('Cardano',`Could not query last delegation payment address for ${stakeKey}. delegation == null`)
        return {
            success: false
        }
    }

    const txOutputResponse = await fetch(process.env.CARDANO_DB_URL+'/tx_out?tx_id=eq.'+delegation['tx_id']+'&limit=1', {
        insecureHTTPParser: true
    });
    const txOutputData = await txOutputResponse.json();
    const txOutput = txOutputData[0];
    if (txOutput == null) {
        logging.error('Cardano',`Could not query last delegation payment address for ${stakeKey}. txOutput == null`)
        return {
            success: false
        }
    }

    // Verify that the stake key is the same as the requested one
    const checkStakeKey = calculateStakeAddress(txOutput.address)
    if (checkStakeKey !== stakeKey) {
        logging.error('Cardano',`Could not verify last delegation payment address for ${stakeKey}. checkStakeKey !== stakeKey`)
        return {
            success: false
        }
    }
    return {
        success: true,
        address: txOutput.address
    }
}
exports.queryLastDelegationPaymentAddress = queryLastDelegationPaymentAddress;

/**
 * Queries the payment addresses for a stake address.
 */
async function queryPaymentAddresses(stakeAddress) {
    const stakeAddressResponse = await fetch(process.env.CARDANO_DB_URL + '/rpc/get_addresses_by_stake_address?p_stake_address='+stakeAddress, {
        insecureHTTPParser: true
    });
    let result = []
    const stakeAddressData = await stakeAddressResponse.json();
    for (const obj of stakeAddressData) {
        result.push(obj.address)
    }
    return result
}
exports.queryPaymentAddresses = queryPaymentAddresses;

/**
 * Gets the balance of a wallet by its name on the node server side.
 */
async function queryWalletBalanceByName(walletName) {
    const response = await fetch(process.env.CARDANO_API_URL+'/api/wallet/balance?name='+walletName, {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {'secret': process.env.CARDANO_API_SECRET}
    });
    const data = await response.json();
    if (data.success === true) {
        return data
    } else if (data.error != null) {
        throw data.error
    } else {
        throw 'Could not get wallet balance for wallet '+walletName
    }
}
exports.queryWalletBalanceByName = queryWalletBalanceByName

/**
 * Gets the balance of a wallet by its stake address.
 */
async function queryWalletBalance(stakeAddress) {
    let addresses = await queryAddresses(stakeAddress);
    let combined = {}
    //console.log('Found', addresses.length,'payment addresses')
    for (const address of addresses) {
        const utxoArray = await queryUtxo(address)
        for (const utxo of utxoArray) {
            for (const [key, value] of Object.entries(utxo.value)) {
                const amount = combined[key]
                if (amount == null) {
                    combined[key] = value;
                } else {
                    combined[key] = amount+value;
                }
            }
        }
    }
    return combined
}
exports.queryWalletBalance = queryWalletBalance

/**
 * Searches all payment addresses for a given stake address.
 */
async function queryAddresses(stakeAddress) {
    const response = await fetch(process.env.CARDANO_DB_URL+'/stake_address?select=id&view=eq.'+stakeAddress, {insecureHTTPParser: true});
    const data = await response.json();
    if (data.length === 0) {
        return null
    }
    const stakeAddressId = data[0].id
    const response2 = await fetch(process.env.CARDANO_DB_URL+'/utxo_view?select=address&stake_address_id=eq.'+stakeAddressId, {insecureHTTPParser: true});
    const data2 = await response2.json();
    let result = []
    for (const object of data2) {
        result.push(object.address)
    }
    return [...new Set(result)]
}
exports.queryAddresses = queryAddresses

/**
 * Gets all UTxOs for a given payment address.
 */
async function queryUtxo(address) {
    const response = await fetch(process.env.CARDANO_API_URL+'/api/queryUtxo?address='+address, {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {'secret': process.env.CARDANO_API_SECRET}
    });
    const data = await response.json();
    return data.utxo
}
exports.queryUtxo = queryUtxo

/**
 * Transfers lovelace.
 */
async function transferLovelace(wallet, address, amount, message, minusTxFee, inputTx) {
    const response = await fetch(process.env.CARDANO_API_URL+'/api/transfer/lovelace', {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {
            'secret': process.env.CARDANO_API_SECRET,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            wallet: wallet,
            address: address,
            amount: amount,
            message: message,
            minusTxFee: minusTxFee,
            inputTx: inputTx
        })
    });
    return await response.json()
}
exports.transferLovelace = transferLovelace


/**
 * Refunds a transaction.
 */
async function refundTransaction(wallet, transactionHash, address, message) {
    const response = await fetch(process.env.CARDANO_API_URL+'/api/refund', {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {
            'secret': process.env.CARDANO_API_SECRET,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            wallet: wallet,
            transactionHash: transactionHash,
            address: address,
            message: message
        })
    });
    return await response.json()
}
exports.refundTransaction = refundTransaction


/**
 * Transfer all ADA and all native tokens of a wallet.
 */
async function wipeWallet(wallet, address) {
    const response = await fetch(process.env.CARDANO_API_URL+'/api/transfer/wipeWallet', {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {
            'secret': process.env.CARDANO_API_SECRET,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            wallet: wallet,
            address: address,
        })
    });
    return await response.json()
}
exports.wipeWallet = wipeWallet


/**
 * Gets all holders for a given asset.
 */
async function queryAssetHolders(assetId) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    //logging.info('Blockfrost', 'Start fetching assets holders for asset '+assetId)
    while (fetchNextPage) {
        //logging.info('Blockfrost', `Fetching page ${page} of asset holders for ${assetId}`)
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/assets/'+assetId+'/addresses?page='+page, {
            headers : {
                project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK'
            }
        });
        if (response.status !== 200) {
            logging.error('Blockfrost', `Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null || json.length === 0) {
            fetchNextPage = false
        }
        if (json.error != null) {
            logging.error('Blockfrost', 'Error while fetching asset holders: '+json.error)
            console.log(json)
            fetchNextPage = false
            return null
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    logging.info('Blockfrost', 'Fetched '+parseInt(page-1)+' pages of assets holders for asset '+assetId)
    return fullResponse
}
exports.queryAssetHolders = queryAssetHolders

/**
 * Gets account info for a given stake address
 */
async function queryAccountInfo(stakeAddress) {
    const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/accounts/'+stakeAddress, {
        headers : {
            project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK'
        }
    });
    if (response.status === 404) {
        logging.info('Blockfrost', 'Account '+stakeAddress+' does not exist')
        return null
    }
    if (response.status !== 200) {
        logging.error('Blockfrost', `Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
        return null
    }
    const json = await response.json()
    if (json == null || json.length === 0) {
        return null
    }
    return json
}
exports.queryAccountInfo = queryAccountInfo

/**
 * Gets asset info and metadata for a given asset
 */
async function queryAssetInfo(asset) {
    const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/assets/'+asset, {
        headers : {
            project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK'
        }
    });
    if (response.status === 404) {
        logging.info('Blockfrost', 'Asset '+asset+' does not exist')
        return null
    }
    if (response.status !== 200) {
        logging.error('Blockfrost', `Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
        return null
    }
    const json = await response.json()
    if (json == null || json.length === 0) {
        return null
    }
    return json
}
exports.queryAssetInfo = queryAssetInfo

/**
 * Query the address of an ADA Handle.
 */
async function queryHandleAddress(handleName) {

    const policyID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
    if (handleName.length === 0) {
        return null
    }

    // Convert handleName to hex encoding.
    const assetName = Buffer.from(handleName).toString('hex');

    // Fetch matching address for the asset.
    const data = await fetch(
        `https://cardano-mainnet.blockfrost.io/api/v0/assets/${policyID}${assetName}/addresses`,
        {
            headers: {
                project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK',
                'Content-Type': 'application/json'
            }
        }
    ).then(res => res.json());

    if (data?.error) {
        logging.error(data?.error)
        return null
    }
    const [{ address }] = data;
    return address
}
exports.queryHandleAddress = queryHandleAddress


/**
 * Gets all assets for a given policy id.
 */
async function queryAssetsOfPolicy(policy) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    while (fetchNextPage) {
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/assets/policy/'+policy+'?page='+page, {
            headers : {
                project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK'
            }
        });
        if (response.status === 404) {
            logging.info('Blockfrost', 'Policy '+policy+' does not exist')
            fetchNextPage = false
            break
        }
        if (response.status !== 200) {
            logging.error('Blockfrost', `Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null) {
            fetchNextPage = false
            logging.error('Blockfrost', `Response could not be parsed`)
            console.log('Response', response)
            console.log('Json', json)
            return null
        }
        if (json.length === 0) {
            fetchNextPage = false
            break
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    //logging.info('Blockfrost', 'Fetched '+parseInt(page-2).toString()+' pages of assets for policy id '+policy)
    return fullResponse
}
exports.queryAssetsOfPolicy = queryAssetsOfPolicy


/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryAssetsForStakeAddress(stakeAddress) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    while (fetchNextPage) {
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/accounts/'+stakeAddress+'/addresses/assets?page='+page, {
            headers : {
                project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK',
                'Content-Type': 'application/json'
            }
        });
        if (response.status === 404) {
            logging.info('Blockfrost', 'Wallet '+stakeAddress+' does not exist')
            return null
        }
        if (response.status !== 200) {
            logging.error('Blockfrost', `Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null) {
            logging.error('Blockfrost', `Response could not be parsed`)
            console.log('Response', response)
            console.log('Json', json)
            return null
        }
        if (json.length === 0) {
            fetchNextPage = false
            break
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    //logging.info('Blockfrost', 'Fetched '+fullResponse.length+' assets on '+parseInt(page-1).toString()+' pages for stake address '+stakeAddress)
    return fullResponse
}
exports.queryAssetsForStakeAddress = queryAssetsForStakeAddress

/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryLatestEpoch() {
    const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/epochs/latest', {
        headers : {
            project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK',
            'Content-Type': 'application/json'
        }
    });
    if (response.status !== 200) {
        response.json().then(console.log).catch(console.log)
        logging.error(response)
        return null
    }
    return await response.json()
}
exports.queryLatestEpoch = queryLatestEpoch

/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryPoolStakeDistribution(epoch, poolId) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    while (fetchNextPage) {
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/epochs/'+epoch+'/stakes/'+poolId+'?page='+page, {
            headers : {
                project_id: 'mainnetdNoK6xpUfTqjcwJDwtX4Q8mo9AngTIYK',
                'Content-Type': 'application/json'
            }
        });
        if (response.status === 404) {
            logging.info('[Blockfrost] Stake pool '+poolId+' or epoch '+epoch+' does not exist')
            return null
        }
        if (response.status !== 200) {
            logging.error(`[Blockfrost] Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null) {
            logging.error('[Blockfrost] Response could not be parsed')
            console.log('Response', response)
            console.log('Json', json)
            return null
        }
        if (json.length === 0) {
            fetchNextPage = false
            break
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    return fullResponse
}
exports.queryPoolStakeDistribution = queryPoolStakeDistribution

/**
 * Returns the stake key for a given payment address.
 */
function calculateStakeAddress(address) {
    let addr = cardanoSerialization.Address.from_bech32(address)
    let base_addr = cardanoSerialization.BaseAddress.from_address(addr)
    if (base_addr == null) {
        return null
    }
    let stake_cred = base_addr.stake_cred()
    let reward_addr_bytes = new Uint8Array(29)
    reward_addr_bytes.set([0xe1], 0)
    reward_addr_bytes.set(stake_cred.to_bytes().slice(4, 32), 1)
    let reward_addr = cardanoSerialization.RewardAddress.from_address(cardanoSerialization.Address.from_bytes(reward_addr_bytes))
    return reward_addr.to_address().to_bech32()
}
exports.calculateStakeAddress = calculateStakeAddress
