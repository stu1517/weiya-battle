const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 確保指向 public 資料夾
app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    teamA: 0,
    teamB: 0,
    started: false, // 預設為 false，必須按開始才會變 true
    timer: null
};

const GAME_DURATION = 30; // 遊戲秒數

io.on('connection', (socket) => {
    // 連線時傳送當前狀態
    socket.emit('updateScore', gameState);
    socket.emit('gameStatus', gameState.started);

    socket.on('click', (team) => {
        // 如果遊戲還沒開始，忽略點擊
        if (!gameState.started) return;
        
        if (team === 'A') gameState.teamA++;
        else if (team === 'B') gameState.teamB++;
        
        // 廣播分數
        io.emit('updateScore', gameState);
    });

    socket.on('adminAction', (action) => {
        console.log('收到管理員指令:', action); // Debug 用

        if (action === 'reset') {
            gameState.teamA = 0;
            gameState.teamB = 0;
            gameState.started = false;
            clearTimeout(gameState.timer);
            
            io.emit('updateScore', gameState);
            io.emit('resetGame');
            io.emit('gameStatus', false); // 告訴手機端遊戲重置(暫停)

        } else if (action === 'start') {
            // 強制重置分數並開始
            gameState.teamA = 0;
            gameState.teamB = 0;
            gameState.started = true;
            
            io.emit('updateScore', gameState);
            io.emit('gameStart', GAME_DURATION);
            io.emit('gameStatus', true); // 告訴手機端遊戲開始

            // 倒數計時
            clearTimeout(gameState.timer);
            gameState.timer = setTimeout(() => {
                gameState.started = false;
                io.emit('gameStatus', false); // 告訴手機端遊戲結束
                
                // 判斷贏家
                let winner = 'DRAW';
                if (gameState.teamA > gameState.teamB) winner = 'A';
                else if (gameState.teamB > gameState.teamA) winner = 'B';
                
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
    console.log(`Server is running on port ${PORT}`);
});