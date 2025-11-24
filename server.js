const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    teamA: 0,
    teamB: 0,
    started: false,
    timer: null // 用來存放倒數計時器物件
};

const GAME_DURATION = 30; // 遊戲秒數設定

io.on('connection', (socket) => {
    socket.emit('updateScore', gameState);
    socket.emit('gameStatus', gameState.started);

    socket.on('click', (team) => {
        if (!gameState.started) return;
        
        if (team === 'A') gameState.teamA++;
        else if (team === 'B') gameState.teamB++;
        
        io.emit('updateScore', gameState);
    });

    socket.on('adminAction', (action) => {
        if (action === 'reset') {
            // 重置遊戲
            gameState.teamA = 0;
            gameState.teamB = 0;
            gameState.started = false;
            clearTimeout(gameState.timer); // 清除舊的計時器
            io.emit('updateScore', gameState);
            io.emit('resetGame'); // 通知前端重置畫面
            
        } else if (action === 'start' && !gameState.started) {
            // 開始遊戲
            gameState.teamA = 0; // 確保分數歸零
            gameState.teamB = 0;
            gameState.started = true;
            
            // 廣播開始，並告訴前端倒數幾秒
            io.emit('updateScore', gameState);
            io.emit('gameStart', GAME_DURATION);

            // 伺服器端設定 30 秒後自動結束
            gameState.timer = setTimeout(() => {
                gameState.started = false;
                
                // 判斷贏家
                let winner = 'DRAW';
                if (gameState.teamA > gameState.teamB) winner = 'A';
                else if (gameState.teamB > gameState.teamA) winner = 'B';
                
                // 廣播遊戲結束與贏家資訊
                io.emit('gameOver', {
                    winner: winner,
                    scoreA: gameState.teamA,
                    scoreB: gameState.teamB
                });
                
            }, GAME_DURATION * 1000);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});