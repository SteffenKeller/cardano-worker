const cron = require('node-cron');
const cardano = require('./cardano')
const stakingRewards = require('./stakingRewards')
const logging = require('./logging');
const GlobalConfig = require("./models/GlobalConfig");

let isProcessingLoop = false
let isProcessingLoop2 = false

const checkForMaintenance = async () => {
    const config = await GlobalConfig.findOne().exec()
    if (config == null) {
        logging.info(null, 'Global config not found')
        return false
    }
    return config.maintenanceCardanoNode === true;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Primary processing loop
 */
cron.schedule('* * * * * *', async () => {
    try {
        if (await checkForMaintenance() === true) {
            logging.info(null, 'Skipping main loop due to maintenance')
            return
        }

        if (isProcessingLoop) {
            logging.info(null, 'Skipping main loop due to active processing')
            return
        }
        isProcessingLoop = true

        // Update the confirmed tx index at first
        await cardano.updateConfirmedTxIndex()

        // Fetch new transactions
        await cardano.checkPendingTransactions()
        await cardano.checkForTransactions(1)

        // Process transactions
        const promises = [
            await stakingRewards.processTransactions(),
            await stakingRewards.processRefunds(),
            await stakingRewards.checkForExpiredClaims(),
        ]

        Promise.allSettled(promises).then((results, e) => {
            results.forEach((result) => {
                if (result.status === 'rejected') {
                    console.log('[ERROR]', result.reason)
                    logging.error(null, result.reason)
                }
            })
            isProcessingLoop = false
        });

    } catch (e) {
        console.timeEnd('cron')
        isProcessingLoop = false
        logging.error(null, e)
    }
});


/**
 * Secondary processing loop (every 2 min)
 */
cron.schedule('*/2 * * * *', async () => {
    try {
        if (await checkForMaintenance() === true) {
            logging.info(null, 'Skipping 2 min loop due to maintenance')
            return
        }

        if (isProcessingLoop2) {
            logging.info(null, 'Skipping 2 min loop due to active processing')
            return
        }
        isProcessingLoop2 = true

        await sleep(5000)
        await cardano.checkForTransactions(2)

        isProcessingLoop2 = false
    } catch (e) {
        isProcessingLoop2 = false
        logging.error(null, e)
    }
});
