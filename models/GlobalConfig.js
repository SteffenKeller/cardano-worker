const mongoose = require('mongoose');

const GlobalConfigSchema = new mongoose.Schema({
    lastConfirmedTxId: {
        type: Number,
        required: true
    },
    maintenance: {
        type: Boolean,
        required: true
    },
    maintenanceCardanoNode : {
        type: Boolean,
        required: true
    },
}, {timestamps: true, collection: 'GlobalConfig' });

module.exports = mongoose.model('GlobalConfig', GlobalConfigSchema);
