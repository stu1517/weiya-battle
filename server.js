const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 設定靜態檔案位置
app.use(express.static(path.join(__dirname, 'public')));

// 遊戲狀態
let gameState = {
    teamA: 0, // 例如：業務部 + 行銷部
    teamB: 0, // 例如：研發部 + 後勤部
    started: false
};

io.on('connection', (socket) => {
    // 當新用戶連線，傳送當前分數
    socket.emit('updateScore', gameState);

    // 接收手機端的點擊事件
    socket.on('click', (team) => {
        if (!gameState.started) return; // 遊戲還沒開始不能按
        
        if (team === 'A') gameState.teamA++;
        else if (team === 'B') gameState.teamB++;
        
        // 優化：不需每次點擊都廣播，可以設定每 100ms 廣播一次以減輕流量，
        // 但為了簡單起見，這裡示範即時廣播
        io.emit('updateScore', gameState);
    });

    // 管理員控制：開始/重置遊戲
    socket.on('adminAction', (action) => {
        if (action === 'reset') {
            gameState.teamA = 0;
            gameState.teamB = 0;
            gameState.started = false;
        } else if (action === 'start') {
            gameState.started = true;
        }
        io.emit('updateScore', gameState);
        io.emit('gameStatus', gameState.started);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});