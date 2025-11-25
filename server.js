const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 設定靜態檔案位置
app.use(express.static(path.join(__dirname, 'public')));

const GAME_DURATION = 30; // 遊戲秒數

// 遊戲狀態
let gameState = {
    teamA: 0, 
    teamB: 0,
    started: false,
    players: {
        A: [], // 儲存紅隊玩家姓名
        B: []  // 儲存藍隊玩家姓名
    }
};

let gameTimer = null;

io.on('connection', (socket) => {
    // 連線時同步狀態
    socket.emit('updateScore', { teamA: gameState.teamA, teamB: gameState.teamB });
    socket.emit('updatePlayers', gameState.players);
    socket.emit('gameStatus', gameState.started);

    // 1. 處理玩家加入 (新增功能)
    socket.on('join', (data) => {
        const { name, team } = data;
        if (!name || !team) return;

        // 簡單防止重複名單 (可選)，這裡直接推入陣列
        if (team === 'A') gameState.players.A.push(name);
        else if (team === 'B') gameState.players.B.push(name);

        // 廣播最新名單給大螢幕
        io.emit('updatePlayers', gameState.players);
    });

    // 2. 接收點擊
    socket.on('click', (team) => {
        if (!gameState.started) return;
        
        if (team === 'A') gameState.teamA++;
        else if (team === 'B') gameState.teamB++;
        
        io.emit('updateScore', { teamA: gameState.teamA, teamB: gameState.teamB });
    });

    // 3. 管理員控制
    socket.on('adminAction', (action) => {
        if (action === 'reset') {
            resetGame();
        } else if (action === 'start') {
            if (!gameState.started) startGame();
        }
    });
});

function startGame() {
    gameState.started = true;
    gameState.teamA = 0;
    gameState.teamB = 0;
    
    // 廣播開始，並傳送倒數秒數
    io.emit('gameStart', GAME_DURATION);
    io.emit('updateScore', { teamA: 0, teamB: 0 });

    // 伺服器端倒數
    if (gameTimer) clearTimeout(gameTimer);
    gameTimer = setTimeout(() => {
        endGame();
    }, GAME_DURATION * 1000);
}

function endGame() {
    gameState.started = false;
    
    // 判斷贏家
    let winner = 'DRAW';
    let winnerNames = [];

    if (gameState.teamA > gameState.teamB) {
        winner = 'A';
        winnerNames = gameState.players.A;
    } else if (gameState.teamB > gameState.teamA) {
        winner = 'B';
        winnerNames = gameState.players.B;
    } else {
        // 平手則顯示所有玩家或不顯示
        winnerNames = [...gameState.players.A, ...gameState.players.B]; 
    }
    
    io.emit('gameOver', {
        winner: winner,
        scoreA: gameState.teamA,
        scoreB: gameState.teamB,
        winnerNames: winnerNames
    });
}

function resetGame() {
    gameState.started = false;
    gameState.teamA = 0;
    gameState.teamB = 0;
    gameState.players = { A: [], B: [] }; // 重置名單
    if (gameTimer) clearTimeout(gameTimer);
    
    io.emit('resetGame');
    io.emit('updatePlayers', gameState.players);
    io.emit('updateScore', { teamA: 0, teamB: 0 });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});