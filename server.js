const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const GAME_DURATION = 30; // 遊戲秒數

// 玩家資料結構
let players = new Map();

// 遊戲狀態
let gameState = {
    teamA_score: 0,
    teamB_score: 0,
    started: false,
    round: 1,
    isGameOver: false
};

let gameTimer = null;

io.on('connection', (socket) => {
    
    // 1. 玩家登入
    socket.on('login', (name) => {
        players.set(socket.id, { name: name, team: '', alive: true });
        socket.emit('loginSuccess');
        broadcastPlayerStats();
    });

    // 2. 玩家選隊伍
    socket.on('joinTeam', (team) => {
        const player = players.get(socket.id);
        if (!player || !player.alive) {
            socket.emit('forceEliminate');
            return;
        }
        player.team = team;
        broadcastPlayerStats();
        socket.emit('waitingForStart', team);
    });

    // 3. 戰鬥點擊
    socket.on('click', (team) => {
        if (!gameState.started) return;
        const player = players.get(socket.id);
        if (!player || !player.alive) return;

        if (team === 'A') gameState.teamA_score++;
        else if (team === 'B') gameState.teamB_score++;
        
        io.emit('updateScore', { a: gameState.teamA_score, b: gameState.teamB_score });
    });

    // 4. 贏家決定是否繼續
    socket.on('continueNextRound', (choice) => {
        const player = players.get(socket.id);
        if (!player) return;

        if (choice === true) {
            player.team = ''; 
            socket.emit('reSelectTeam'); 
        } else {
            player.alive = false; 
            socket.emit('showForfeit'); 
            checkAllForfeit(); 
        }
        broadcastPlayerStats();
    });

    socket.on('disconnect', () => {
        if (players.has(socket.id)) {
            players.delete(socket.id);
            broadcastPlayerStats();
        }
    });

    // --- 管理員指令 (關鍵修正區) ---
    socket.on('adminAction', (action) => {
        console.log(`[Admin Command Received]: ${action}`); // 加入 Log 以便除錯

        if (action === 'start') {
            startGame();
        } else if (action === 'nextRound') {
            prepareNextRound();
        } else if (action === 'resetAll') {
            resetAllGame();
        }
    });
});

function broadcastPlayerStats() {
    let listA = [];
    let listB = [];
    let survivors = 0;

    players.forEach((p) => {
        if (p.alive) {
            survivors++;
            if (p.team === 'A') listA.push(p.name);
            if (p.team === 'B') listB.push(p.name);
        }
    });

    io.emit('updatePlayerList', { A: listA, B: listB, totalSurvivors: survivors, round: gameState.round });
}

function startGame() {
    if (gameState.started) return;

    let countA = 0, countB = 0;
    players.forEach(p => {
        if (p.alive) {
            if (p.team === 'A') countA++;
            if (p.team === 'B') countB++;
        }
    });

    // 只有當總存活人數 > 1 時才檢查平衡
    if (countA + countB > 1) {
        if (countA === 0 || countB === 0) {
            io.emit('showWarning', '無法開始！紅隊或藍隊不能為 0 人。');
            io.emit('teamUnbalanced'); 
            return;
        }
    }

    gameState.teamA_score = 0;
    gameState.teamB_score = 0;
    gameState.started = true;

    io.emit('gameStart', GAME_DURATION);
    io.emit('updateScore', { a: 0, b: 0 });

    if (gameTimer) clearTimeout(gameTimer);
    gameTimer = setTimeout(() => {
        endRound();
    }, GAME_DURATION * 1000);
}

function endRound() {
    gameState.started = false;
    
    let winnerTeam = 'DRAW';
    if (gameState.teamA_score > gameState.teamB_score) winnerTeam = 'A';
    else if (gameState.teamB_score > gameState.teamA_score) winnerTeam = 'B';
    
    let winnerNames = [];
    let survivorCount = 0;

    players.forEach((p, socketId) => {
        if (!p.alive) return; 

        if (winnerTeam === 'DRAW') {
            winnerNames.push(p.name);
            survivorCount++;
            io.to(socketId).emit('roundResult', { result: 'draw' }); // 平手視同晉級
        } 
        else if (p.team === winnerTeam) {
            winnerNames.push(p.name);
            survivorCount++;
            io.to(socketId).emit('roundResult', { result: 'win' });
        } 
        else {
            p.alive = false; 
            io.to(socketId).emit('roundResult', { result: 'lose' });
        }
    });

    let isUltimateWinner = (survivorCount === 1);
    
    io.emit('roundOver', {
        winnerTeam: winnerTeam,
        scoreA: gameState.teamA_score,
        scoreB: gameState.teamB_score,
        winnerNames: winnerNames,
        survivorCount: survivorCount,
        isUltimateWinner: isUltimateWinner
    });

    if (isUltimateWinner) {
        gameState.isGameOver = true;
    }
}

// 關鍵修正：準備下一場
function prepareNextRound() {
    console.log('Executing prepareNextRound...'); // Log
    
    // 如果遊戲已結束(冠軍產生)，則不執行，除非重置
    if (gameState.isGameOver) {
        console.log('Game is over, cannot go next round.');
        return; 
    }

    gameState.round++;
    gameState.teamA_score = 0;
    gameState.teamB_score = 0;
    
    // 清除隊伍選擇
    players.forEach(p => {
        if (p.alive) p.team = '';
    });

    console.log(`Round updated to ${gameState.round}, resetting screen.`);
    broadcastPlayerStats();
    io.emit('resetScreenForNextRound', gameState.round);
}

function resetAllGame() {
    players.clear();
    gameState.round = 1;
    gameState.isGameOver = false;
    io.emit('reload'); 
}

function checkAllForfeit() {
    let activeSurvivors = 0;
    players.forEach(p => { if (p.alive) activeSurvivors++; });

    if (activeSurvivors === 0 && !gameState.isGameOver) {
        io.emit('allForfeit'); 
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});