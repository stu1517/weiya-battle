const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 設定公開資料夾
app.use(express.static(path.join(__dirname, 'public')));

// 遊戲參數設定
const GAME_DURATION = 30; // 遊戲秒數

// 遊戲狀態
let gameState = {
    teamA: 0,
    teamB: 0,
    started: false,
    timerObj: null // 用來存計時器
};

io.on('connection', (socket) => {
    // 連線時同步目前分數與狀態
    socket.emit('updateScore', gameState);
    socket.emit('gameStatus', gameState.started);

    // 接收點擊
    socket.on('click', (team) => {
        if (!gameState.started) return; // 沒開始不能按
        
        if (team === 'A') gameState.teamA++;
        else if (team === 'B') gameState.teamB++;
        
        // 廣播分數 (為了效能，多人時可優化為節流廣播，但數百人此寫法尚可)
        io.emit('updateScore', gameState);
    });

    // 管理員指令 (S鍵開始, R鍵重置)
    socket.on('adminAction', (action) => {
        if (action === 'reset') {
            resetGame();
        } else if (action === 'start') {
            if (!gameState.started) startGame();
        }
    });
});

function startGame() {
    // 初始化
    gameState.teamA = 0;
    gameState.teamB = 0;
    gameState.started = true;
    
    // 通知前端：遊戲開始，倒數 N 秒
    io.emit('gameStart', GAME_DURATION);
    io.emit('updateScore', gameState);

    // 伺服器端倒數，時間到自動結束
    gameState.timerObj = setTimeout(() => {
        endGame();
    }, GAME_DURATION * 1000);
}

function endGame() {
    gameState.started = false;
    
    // 判斷贏家
    let winner = 'DRAW';
    if (gameState.teamA > gameState.teamB) winner = 'A';
    else if (gameState.teamB > gameState.teamA) winner = 'B';
    
    // 廣播結果
    io.emit('gameOver', {
        winner: winner,
        scoreA: gameState.teamA,
        scoreB: gameState.teamB
    });
}

function resetGame() {
    gameState.started = false;
    gameState.teamA = 0;
    gameState.teamB = 0;
    if (gameState.timerObj) clearTimeout(gameState.timerObj); // 清除計時
    
    io.emit('resetGame');
    io.emit('updateScore', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});