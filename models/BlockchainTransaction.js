const mongoose = require('mongoose');

const BlockchainTransactionSchema = new mongoose.Schema({
    hash: {
        type: String,
        unique: true,
        required: true
    },
    project: {
        type: String
    },
    transactionId: {
        type: Number,
        index: true,
        unique: true,
        required: true
    },
    receiverAddress: {
        type: String,
        required: true
    },
    senderAddress: {
        type: String,
        required: true
    },
    senderStakeAddress: {
        type: String
    },
    value: {
        type: Number,
        required: true
    },
    nativeTokens: {
        type: Object,
    },
    message: {
        type: String,
    },
    status: {
        type: String,
        enum: ['OPEN', 'PROCESSING', 'PROCESSING_REFUND', 'AWAITING_MINT', 'PENDING', 'PENDING_REFUND', 'INTERN', 'INVALID', 'ERROR', 'REFUNDED', 'COMPLETED'],
        required: true
    },
    reservedMintAssets: {
        type: Number
    },
    mintedAssets: {
        type: Object
    },
    refundReason: {
        type: String
    },
    refundHash: {
        type: String
    },
    error: {
        type: String
    },
    input: {
        type: Array,
        required: true
    },
    inputRef: {
        type: Array
    },
    output: {
        type: Array,
        required: true
    },
    validContract: {
        type: Boolean
    },
    blockId: {
        type: Number
    },
    blockIndex: {
        type: Number
    },
    actionHash: {
        type: String
    },
    actionAmount: {
        type: Number
    },
    actionFee: {
        type: Number
    }
}, {timestamps: true, collection: 'BlockchainTransaction' });


module.exports = mongoose.model('BlockchainTransaction', BlockchainTransactionSchema);
