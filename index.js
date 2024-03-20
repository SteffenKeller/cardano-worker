require('dotenv').config()
const mongoose = require('mongoose');
const cardano = require('./cardano');
const logging = require('./logging');
const fs = require('fs')

if (fs.existsSync(`logs/`) === false) {
    fs.mkdirSync(`logs`)
}

mongoose.connect(process.env.DATABASE_URL).then(function () {
    logging.info(null, 'Connected to database')
    cardano.updateConfirmedTxIndex().then(async () => {
        logging.info('Cardano', 'Considering all transactions until block_no '+cardano.confirmedBlockId()+' and tx_id '+cardano.confirmedTxId()+' as confirmed')
        await cardano.checkNodeStatus()
        await cardano.checkDbSyncStatus()
        require('./cron')
    }).catch((e) => {
        logging.error(null, 'Error in startup script: '+e)
    })
})

