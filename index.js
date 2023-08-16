const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const configData = fs.readFileSync('./config.json', 'utf8');
const config = JSON.parse(configData);

function writeLog(logMessage) {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
  const day = currentDate.getDate().toString().padStart(2, '0');
  const formattedDate = `${year}-${month}-${day}`;
  const currentDateTime = currentDate.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');

  const logDirectory = path.join(__dirname, 'logs');
  const logFilePath = path.join(logDirectory, `${formattedDate}.log`);
  logMessage = '\n' + formattedDate + ' ' + currentDateTime + '\n' + logMessage;

  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
  }

  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) {
      console.error('Error writing log:', err);
    } else {
      console.log(logMessage);
    }
  });
}

// 要读取的文件夹路径
const folderPath = './';

// 获取文件夹中的所有文件
const files = fs.readdirSync(folderPath);

// 过滤出 .db 文件
const dbFiles = files.filter(file => path.extname(file) === '.db');
// 解密出来的最后一个db文件
const lastDbFile = dbFiles[dbFiles.length - 1];

// 创建一个数据库连接
// 微信数据库
const microDb = new sqlite3.Database('MicroMsg.db');
// 最新的解密db库连接
const msgDb = new sqlite3.Database(lastDbFile);

// 微信基础数据
microDb.serialize(() => {
  microDb.each('SELECT count(1) as count FROM ChatRoom', (err, row) => {
    if (err) {
      console.error('microDb', err.message);
    } else {
      let count = row.count;
      writeLog(`[chatroom微信群条数]：${JSON.stringify(count)}`);

      let chatroomList = [];
      let promises = [];

      for (let i = 0; i < count; i += 100) {
        writeLog(`[chatroom查询微信群页数]第${JSON.stringify(Math.ceil(i / 100) + 1)}页`);

        let promise = new Promise((resolve, reject) => {
          microDb.each('SELECT * FROM ChatRoom limit 100 offset ?', [i], (err, row) => {
            if (err) {
              console.error('microDb', err.message);
              reject(err);
            } else {
              if (row.RoomData) {
                row.RoomData = '';
              }
              chatroomList.push(row);
              resolve(row);
            }
          });
        });

        promises.push(promise);
      }

      Promise.all(promises)
        .then(() => {
          // 把chatroomList按每100条拆分数组,然后去调服务端接口
          for (let i = 0; i < chatroomList.length; i += 100) {
            let chunkedArrays = chatroomList.slice(i, i + 100);
            // console.log(chunkedArrays);
            // 发起接口请求
            writeLog(`[推送chatroomList第${(Math.ceil(i / 100) + 1)}页]：url: ${JSON.stringify(`${config.url}/scrm/wx/wx-chatroom/push-chatroom`)}, body: ${JSON.stringify({
              list: chunkedArrays
            })}`);
            axios.post(`${config.url}/scrm/wx/wx-chatroom/push-chatroom`, {
              list: chunkedArrays
            }, {
              headers: {
                'Content-Type': 'application/json'
              }
            }).then(result => {
              console.log(result.data);
            })
          }

        })
        .catch(error => {
          console.error('Error:', error);
        });
    }
  });
});


// 查询msg数据
msgDb.serialize(() => {
  msgDb.each('SELECT * FROM MSG limit 10', (err, row) => {
    if (err) {
      console.error('msgDb', err.message);
    } else {
      let BytesExtra = row.BytesExtra
      BytesExtra = BytesExtra.toString('utf-8')
      // console.log(row.localId, row.StrContent, BytesExtra);
    }
  });
});

// 等待一段时间后退出应用程序
setTimeout(() => {
  microDb.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('microDb数据库连接已关闭');
    }
  })
  msgDb.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('msg数据库连接已关闭');
    }
    process.exit(); // 退出应用程序
  });
}, 5000); // 5秒后退出
