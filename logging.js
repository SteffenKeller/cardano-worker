const fs = require('fs');

exports.info = function (project, message, print) {
    const date = new Date();
    let logMessage = `${date.toISOString()} [INFO] ${message}`
    if (project != null) {
        logMessage = `${date.toISOString()} [INFO] [${project}] ${message}`
    }
    if (print !== false) {
        console.log(logMessage)
    }
    writeToFile(logMessage)
}

exports.error = function (project, message) {
    const date = new Date();
    let logMessage = `${date.toISOString()} [ERROR] ⚠️  ${message}`
    if (project != null) {
        logMessage = `${date.toISOString()} [ERROR] [${project}] ⚠️  ${message}`
    }
    console.log(logMessage)
    writeToFile(logMessage)
}

function writeToFile(logMessage) {
    const date = new Date();
    const filename = `logs/${date.toISOString().substr(0, 10)}.log`
    fs.appendFile(filename, logMessage+'\n', function (err) {
        if(err != null && err.code === 'ENOENT') {
            fs.writeFile(filename, '', function (err) {
                if (err) return console.log('[ERROR]',err);
                fs.appendFile(filename, logMessage+'\n', function (err) {
                    if (err) return console.log('[ERROR]',err);
                });
            });
        } else if (err != null) {
            console.log('[ERROR]',err);
        }
    });
}