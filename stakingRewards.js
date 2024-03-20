const logging = require('./logging');
const fetch = require("node-fetch");
const cardano = require("./cardano");
const BlockchainTransaction = require('./models/BlockchainTransaction')
const StakeClaim = require('./models/StakeClaim')
const StakeReward = require('./models/StakeReward')
const StakeAsset = require('./models/StakeAsset')
let address = '' // Address of the staking wallet
let project = 'staking' // Project name of the BlockchainMonitoring object for the staking wallet address
let walletName = '' // Wallet name of the staking wallet (must be the same as on the node API server)

const processTransaction = async () => {

    // Check if the last action has been submitted successfully
    let pendingTx = await BlockchainTransaction.findOne({receiverAddress: address, status: 'PENDING', project: project}).sort({transactionId: -1})
    if (pendingTx != null) {
        // There are still transactions pending
        //logging.info('Staking', 'Waiting with processing until last tx was successful')
        return
    }

    // Query transactions
    let transactions = await BlockchainTransaction.find({receiverAddress: address, status: 'OPEN', project: project}).limit(10).sort({transactionId: 1})
    if (transactions.length === 0) {
        //logging.info('Staking', 'No open transactions found')
        return
    }

    let processingClaims = []
    let inputTransactions = []
    let recipients = {}
    for (const transaction of transactions) {

        // Intern if tokens are contained
        if (transaction.nativeTokens != null && transaction.nativeTokens.length !== 0) {
            logging.info('Staking', 'Transaction '+transaction.hash +' handled as INTERN because native tokens are contained')
            transaction.status = 'INTERN'
            await transaction.save();
            // Update reward asset balances
            for (const nativeToken of transaction.nativeTokens) {
                const assetId = nativeToken.policy+'.'+nativeToken.assetNameHex
                const stakeReward = await StakeReward.findOne({assetId: assetId}).exec()
                if (stakeReward != null) {
                    stakeReward.balance = stakeReward.balance+parseInt(nativeToken.quantity)
                    await stakeReward.save()
                    logging.info('Staking', 'Received '+parseInt(nativeToken.quantity)+' tokens of stake reward '+nativeToken.assetName+' and incremented balance')
                } else {
                    logging.info('Staking', 'Received '+parseInt(nativeToken.quantity)+' tokens of unknown asset '+nativeToken.assetName)
                }
            }
            continue
        }

        // Invalidate if no stake address
        if (transaction.senderStakeAddress == null) {
            logging.info('Staking', 'Transaction '+transaction.hash +' invalidated because of missing stake address')
            transaction.status = 'INVALID'
            transaction.refundReason = 'Missing stake address'
            await transaction.save();
            continue
        }

        // Error if value is too low to refund
        if (transaction.value < 2_000_000) {
            logging.info('Staking', 'Transaction '+transaction.hash +' cannot be refunded and was marked as error')
            transaction.status = 'ERROR'
            transaction.error = 'Value to low to refund'
            await transaction.save();
            continue
        }

        // Search for Stake Claim
        const claim = await StakeClaim.findOne({status: 'OPEN', stakeAddress: transaction.senderStakeAddress}).exec()
        if (claim == null) {
            logging.info('Staking', 'Transaction '+transaction.hash +' invalidated because of missing stake claim')
            transaction.status = 'INVALID'
            transaction.refundReason = 'Refund'
            await transaction.save();
            continue
        }

        // Check if value is correct
        if (transaction.value < claim.paymentAmount) {
            logging.info('Staking', 'Transaction '+transaction.hash +' invalidated due to insufficient payment')
            transaction.status = 'INVALID'
            transaction.refundReason = 'Insufficient payment'
            await transaction.save();
            claim.status = 'INVALID'
            claim.error = 'Transaction refunded due to insufficient payment'
            await claim.save();

            // Release reserved tokens
            for (const [key, value] of Object.entries(claim.assets)) {
                const stakeReward = await StakeReward.findOne({assetId: key}).exec()
                if (stakeReward == null) {
                    logging.error(`Could not find rewards asset ${key}`)
                }
                // Decrement balances
                stakeReward.reservedBalance = stakeReward.reservedBalance-value
                await stakeReward.save()
            }
            continue
        }

        // Prevent franken address exploit
        const lastDelegationCheck = await cardano.queryLastDelegationPaymentAddress(transaction.senderStakeAddress)
        if (lastDelegationCheck.success !== true) {
            logging.info('Staking', 'Transaction '+transaction.hash +' invalidated due to failed last delegation check')
            transaction.status = 'INVALID'
            await transaction.save();
            claim.status = 'INVALID'
            claim.error = 'Transaction did not pass security checks'
            await claim.save();
        }
        const paymentAddress = lastDelegationCheck.address


        // Send the rewards
        recipients[paymentAddress] = {...claim.assets}

        // Remove zero values
        for (const [key, value] of Object.entries(recipients[paymentAddress])) {
            if (value === 0) {
                delete recipients[paymentAddress][key]
            }
        }

        // Set a custom lovelace value
        recipients[paymentAddress].lovelace = claim.paymentAmount-claim.serviceFee-500_000

        // Add transaction as input
        inputTransactions.push(transaction.hash)

        // Track status
        processingClaims.push(claim)
        claim.status = 'PROCESSING'
        claim.paymentHash = transaction.hash
        await claim.save();
        transaction.status = 'PROCESSING'
        await transaction.save();
        logging.info('Staking', 'Processing transaction '+transaction.hash+' for claim '+claim.sessionId)
    }

    if (Object.keys(recipients).length === 0) {
        logging.info('Staking','Skipping processing because there are no recipients')
        return
    }

    // TODO: Set tx inputs that shall be used to send / or exclude tx inputs that will be refunded

    const response = await fetch(process.env.CARDANO_API_URL+'/api/transfer/multipleAssetsToRecipients', {
        insecureHTTPParser: true,
        method: 'POST',
        headers: {
            'secret': process.env.CARDANO_API_SECRET,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            recipients: recipients,
            wallet: walletName,
           inputTransactions: inputTransactions
        })
    });
    const result = await response.json();

    if (result.success === true) {
        logging.info('Staking', 'Successfully processed transactions in tx '+result.transaction)
        for (const transaction of transactions) {
            if (transaction.status !== 'INVALID') {
                transaction.status = 'PENDING'
                transaction.actionHash = result.transaction
                transaction.actionFee = result.networkFee
                await transaction.save()
            }
        }
        for (const claim of processingClaims) {
            claim.status = 'COMPLETED'
            claim.actionHash = result.transaction
            await claim.save();

            // Update reward asset balances
            for (const [key, value] of Object.entries(claim.assets)) {
                if (key === 'lovelace') {
                    continue
                }
                const stakeReward = await StakeReward.findOne({assetId: key}).exec()
                if (stakeReward == null) {
                    logging.error('Staking',`Could not find rewards asset ${key}`)
                }
                // Decrement balances
                stakeReward.balance = stakeReward.balance-value
                stakeReward.reservedBalance = stakeReward.reservedBalance-value
                stakeReward.totalClaimedAmount = stakeReward.totalClaimedAmount+value
                stakeReward.totalClaims = stakeReward.totalClaims+1
                await stakeReward.save()
            }

            // Update stake assets
            for (const [key, value] of Object.entries(claim.assetRewards)) {
                const stakeAsset = await StakeAsset.findOne({assetId: key}).exec()
                stakeAsset.lastClaim = new Date()
                stakeAsset.totalClaimedAmount = stakeAsset.totalClaimedAmount+value
                stakeAsset.totalClaims = stakeAsset.totalClaims+1
                await stakeAsset.save()
            }
        }
    } else {
        logging.error('Staking', 'Could not process transactions. Server error: '+result.error)
        for (const transaction of transactions) {
            if (transaction.status !== 'INVALID') {
                transaction.status = 'ERROR'
                transaction.error = result.error
                await transaction.save()
            }
        }
        for (const claim of processingClaims) {
            claim.status = 'ERROR'
            claim.error = 'There was and error while sending your assets. Please contact our support team to resolve the issue.'
            await claim.save();

            // Release reserved tokens
            for (const [key, value] of Object.entries(claim.assets)) {
                if (key === 'lovelace') {
                    continue
                }
                const stakeReward = await StakeReward.findOne({assetId: key}).exec()
                if (stakeReward == null) {
                    logging.error('Staking',`Could not find rewards asset ${key}`)
                }
                // Decrement balances
                stakeReward.reservedBalance = stakeReward.reservedBalance-value
                await stakeReward.save()
            }
        }
    }
}
exports.processTransactions = processTransaction

const checkForExpiredClaims = async () => {

    let date = new Date()
    date.setHours(date.getHours()-6)

    const claims = await StakeClaim.find({createdAt: {$lt: date}, status: 'OPEN'}).exec()
    for (const claim of claims) {
        claim.status = 'EXPIRED'
        claim.error = 'The session is expired'
        await claim.save();
        // Release reserved tokens
        for (const [key, value] of Object.entries(claim.assets)) {
            const stakeReward = await StakeReward.findOne({assetId: key}).exec()
            if (stakeReward == null) {
                logging.error(`Could not find rewards asset ${key}`)
            }
            // Decrement balances
            stakeReward.reservedBalance = stakeReward.reservedBalance-value
            await stakeReward.save()
        }
        logging.info('Staking', 'Claim session '+claim.sessionId+' is expired')
    }
}
exports.checkForExpiredClaims = checkForExpiredClaims

const processRefunds = async () => {

    // Check if there are pending transactions
    let pendingTx = await BlockchainTransaction.findOne({receiverAddress: address, status: 'PENDING', project: project}).sort({transactionId: -1}).exec()
    if (pendingTx != null) {
        return
    }

    // Query invalid transactions to this address
    const invalidTransaction = await BlockchainTransaction.findOne({status: 'INVALID', receiverAddress: address, project: project}).sort({transactionId: -1}).exec()
    if (invalidTransaction == null) {
        return
    }
    logging.info('Staking', 'Refunding invalid transaction '+invalidTransaction.hash)

    const result = await cardano.refundTransaction(walletName, invalidTransaction.hash, invalidTransaction.senderAddress, invalidTransaction.refundReason)
    if (result.success === true) {
        logging.info('Staking', 'Refund for transaction '+invalidTransaction.hash+' processed in transaction '+result.transaction)
        invalidTransaction.status = 'PENDING'
        invalidTransaction.refundHash = result.transaction
        await invalidTransaction.save()
    } else {
        logging.error('Staking', 'Could not process refund. Server error: '+result.error)
        invalidTransaction.status = 'ERROR'
        invalidTransaction.error = result.error.toString()
        await invalidTransaction.save()
    }

}
exports.processRefunds = processRefunds

