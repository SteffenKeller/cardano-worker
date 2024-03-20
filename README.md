# Cardano Worker

This worker server constantly checks for transactions on specific addresses on the Cardano blockchain, and stores them in a MongoDB database for later processing. The worker will check transactions for each address defined in a monitoring object (`models/BlockachinMonitoring.js`) and stores a corresponding transaction object (`models/BlockachinTransaction.js`) with a matching project key. The system will prioritize queries based on the recent activity on the address.

This server is also capable of processing transactions for a custodial CNFT staking system, the logic of which can be found in the `stakingRewards.js` file.  The corresponding claim sessions (`models/StakeClaim.js`) are created by the [Cardano Staking API](https://github.com/SteffenKeller/cardano-staking-api) server. This worker will process the incoming transactions and call the [Cardano Node API](https://github.com/SteffenKeller/cardano-node-api) to send back the tokens.

## Requirements

The server requires a connection to a server running [Cardano Node](https://github.com/IntersectMBO/cardano-node) and [DB Sync](https://github.com/IntersectMBO/cardano-db-sync) with [PostgREST](https://postgrest.org) to query DB Sync data and [Cardano Node API](https://github.com/SteffenKeller/cardano-node-api) to submit transactions. 

## Environment variables 

- `DATABASE_URL` - MongoDB Connection String
- `CARDANO_API_SECRET` - Shared secret with the Cardano Node API
- `CARDANO_API_URL` - URL of the Cardano Node API
- `CARDANO_DB_URL` - URL of the PostgREST API server

## Running the system 

Run the worker with `node index.js`
