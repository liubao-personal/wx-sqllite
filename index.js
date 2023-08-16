const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 配置信息
const configData = fs.readFileSync('./config.json', 'utf8');
const config = JSON.parse(configData);

// 上传微信人
const weChatData = fs.readFileSync('./wechat_info.json', 'utf8');
const weChatInfo = JSON.parse(weChatData);

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
const BATCH_SIZE = 100; // 分割条数
const DELAY_BETWEEN_REQUESTS = 1000; // 1秒的延迟

// 延迟时长方法
function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// 查询数据库并返回 Promise
function queryDatabase(query, params) {
  return new Promise((resolve, reject) => {
    microDb.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// 推送数据至服务器
async function pushDataToServer(url, data, pageNum) {
  try {
    const result = await axios.post(url, {
      list: data
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    writeLog(`[推送${url}第${pageNum}页结果]：` + JSON.stringify(result.data));
  } catch (error) {
    console.error('Error:', error);
  }
}

// chatroom同步方法
async function chatRoomFunction() {
  // 同步chatroom表
  const [{ count }] = await queryDatabase('SELECT count(1) as count FROM ChatRoom');

  writeLog(`[chatroom微信群条数]：${JSON.stringify(count)}`);

  const chatroomList = [];

  for (let i = 0; i < count; i += BATCH_SIZE) {
    writeLog(`[chatroom查询微信群页数]第${Math.ceil(i / BATCH_SIZE) + 1}页`);

    const rows = await queryDatabase('SELECT * FROM ChatRoom limit ? offset ?', [BATCH_SIZE, i]);

    rows.forEach(row => {
      if (row.RoomData) {
        row.RoomData = '';
      }
      row.pusherAccount = weChatInfo['Account'];
      row.pusherNickName = weChatInfo['NickName'];
      row.pusherMobile = weChatInfo['Mobile'];
      row.pusherKey = weChatInfo['Key'];
      chatroomList.push(row);
    });
  }

  const chunkedRequests = [];

  for (let i = 0; i < chatroomList.length; i += BATCH_SIZE) {
    chunkedRequests.push(chatroomList.slice(i, i + BATCH_SIZE));
  }

  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;

      writeLog(`[推送chatroomList第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomUrl}`)}, body: ${JSON.stringify({
        list: chunkedArray
      })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomUrl}`, chunkedArray, pageNum);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  };

  await sendRequests();
}

// chatroomInfo同步方法
async function chatRoomInfoFunction() {
  const chatRoomInfoList = await queryDatabase('SELECT * FROM ChatRoomInfo');
  chatRoomInfoList.forEach(row => {
    row.pusherAccount = weChatInfo['Account'];
    row.pusherNickName = weChatInfo['NickName'];
    row.pusherMobile = weChatInfo['Mobile'];
    row.pusherKey = weChatInfo['Key'];
  });


  const chunkedRequests = [];

  for (let i = 0; i < chatRoomInfoList.length; i += BATCH_SIZE) {
    chunkedRequests.push(chatRoomInfoList.slice(i, i + BATCH_SIZE));
  }
  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;

      writeLog(`[推送chatroomInfo第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomInfoUrl}`)}, body: ${JSON.stringify({
        list: chunkedArray
      })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomInfoUrl}`, chunkedArray, pageNum);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  };
  sendRequests();

}

microDb.serialize(async () => {
  try {
    await chatRoomFunction();
    await chatRoomInfoFunction();
  } catch (error) {
    console.error('Error:', error);
  }
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
}, 10000); // 5秒后退出

