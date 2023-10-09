## 微信采集上传工具

### 本项目支持把采集到的sqllite的db文件解析后上传到指定服务器上，配置外挂出去，可配置上传条数等

| 采集上传的数据 | 对应服务器的表                 |
|---------|-------------------------|
| 微信社群    | ms_wx_chatroom          |
| 微信社群成员  | ms_wx_chatroom_members  |
| 微信客户    | ms_wx_contact           |
| 微信客户关系  | ms_wx_contact_relations |
| 微信消息    | ms_wx_msg               |

### 工具说明
本工具是打包成exe的软件，必须在windows环境下运行
### 打包生成exe命令
```bash
前置安装：npm install -g pkg
npm run pkg
```

### 使用说明
#### 前置依赖: `必须先用微信采集工具先把数据采集到`
在本项目里双击运行

