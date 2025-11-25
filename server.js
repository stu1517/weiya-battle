const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const GAME_DURATION = 30; // 遊戲秒數

// 玩家資料結構：Key=SocketID, Value={ name, team, alive (是否存活) }
let players = new Map();

// 遊戲狀態
let gameState = {
    teamA_score: 0,
    teamB_score: 0,
    started: false,
    round: 1,           // 第幾回合
    isGameOver: false   // 是否產生最終冠軍
};

let gameTimer = null;

io.on('connection', (socket) => {
    
    // 1. 玩家登入 (第一場比賽)
    socket.on('login', (name) => {
        // 預設登入時是存活狀態
        players.set(socket.id, { name: name, team: '', alive: true });
        socket.emit('loginSuccess');
        broadcastPlayerStats(); // 更新大螢幕人數
    });

    // 2. 玩家選隊伍 / 贏家重新選隊伍
    socket.on('joinTeam', (team) => {
        const player = players.get(socket.id);
        
        // 安全檢查：只有存活的玩家可以選隊伍
        if (!player || !player.alive) {
            socket.emit('forceEliminate'); // 踢除非法操作
            return;
        }

        player.team = team;
        
        // 檢查是否違反「單邊 0 人」規則 (即時廣播目前分配狀況)
        broadcastPlayerStats();
        
        // 通知手機端進入等待畫面
        socket.emit('waitingForStart', team);
    });

    // 3. 接收戰鬥點擊
    socket.on('click', (team) => {
        if (!gameState.started) return;
        
        // 再次確認玩家是否存活 (防作弊)
        const player = players.get(socket.id);
        if (!player || !player.alive) return;

        if (team === 'A') gameState.teamA_score++;
        else if (team === 'B') gameState.teamB_score++;
        
        // 廣播分數
        io.emit('updateScore', { a: gameState.teamA_score, b: gameState.teamB_score });
    });

    // 4. 贏家決定繼續下一場 (需求3)
    socket.on('continueNextRound', (choice) => {
        const player = players.get(socket.id);
        if (!player) return;

        if (choice === true) {
            // 願意繼續：重置隊伍，回到選隊畫面
            player.team = ''; 
            socket.emit('reSelectTeam'); // 手機端切換到選隊頁
        } else {
            // 自願放棄 (需求3)
            player.alive = false; //視同淘汰
            socket.emit('showForfeit'); // 手機顯示放棄畫面
            checkAllForfeit(); // 檢查是否所有人都放棄了
        }
        broadcastPlayerStats();
    });

    // 5. 斷線處理
    socket.on('disconnect', () => {
        if (players.has(socket.id)) {
            players.delete(socket.id);
            broadcastPlayerStats();
        }
    });

    // --- 管理員指令 ---

    socket.on('adminAction', (action) => {
        if (action === 'start') {
            startGame(socket);
        } else if (action === 'nextRound') {
            prepareNextRound();
        } else if (action === 'resetAll') {
            // 全域重置 (測試用)
            players.clear();
            gameState.round = 1;
            io.emit('reload'); // 強制所有瀏覽器重整
        }
    });
});

// 廣播目前的隊伍人數與名單給大螢幕
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

function startGame(adminSocket) {
    if (gameState.started) return;

    // 需求(5) 檢查隊伍人數
    let countA = 0, countB = 0;
    players.forEach(p => {
        if (p.alive) {
            if (p.team === 'A') countA++;
            if (p.team === 'B') countB++;
        }
    });

    // 只有當總存活人數 > 1 時才需要檢查分隊平衡
    // 如果只剩 1 人，直接宣布冠軍，不需要檢查隊伍
    if (countA + countB > 1) {
        if (countA === 0 || countB === 0) {
            // 發送警告給大螢幕
            io.emit('showWarning', '無法開始！紅隊或藍隊不能為 0 人，請玩家重新分配。');
            // 發送警告給手機 (讓他們知道要換隊)
            io.emit('teamUnbalanced'); 
            return;
        }
    }

    // 初始化戰局
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

    // 處理淘汰邏輯
    players.forEach((p, socketId) => {
        if (!p.alive) return; // 已經淘汰的不處理

        if (winnerTeam === 'DRAW') {
            // 平手：沒人淘汰 (或是全部淘汰? 通常平手大家一起晉級比較好玩)
            winnerNames.push(p.name);
            survivorCount++;
            // 通知手機：平手
            io.emit('roundResult', { result: 'draw', round: gameState.round });
        } 
        else if (p.team === winnerTeam) {
            // 贏家
            winnerNames.push(p.name);
            survivorCount++;
            // 需求(3) 通知贏家手機：詢問是否繼續
            io.to(socketId).emit('roundResult', { result: 'win' });
        } 
        else {
            // 輸家 (需求4)
            p.alive = false; // 標記淘汰
            // 通知輸家手機
            io.to(socketId).emit('roundResult', { result: 'lose' });
        }
    });

    // 需求(6) 判斷是否產生最終冠軍 (剩1人)
    let isUltimateWinner = (survivorCount === 1);
    
    io.emit('roundOver', {
        winnerTeam: winnerTeam,
        scoreA: gameState.teamA_score,
        scoreB: gameState.teamB_score,
        winnerNames: winnerNames,
        survivorCount: survivorCount, // 需求(1) 顯示人數
        isUltimateWinner: isUltimateWinner
    });

    // 如果只剩1人，遊戲結束
    if (isUltimateWinner) {
        gameState.isGameOver = true;
    }
}

// 需求(2) 準備下一場
function prepareNextRound() {
    if (gameState.isGameOver) return; // 已經結束就不下一場了

    gameState.round++;
    gameState.teamA_score = 0;
    gameState.teamB_score = 0;
    
    // 清除所有存活玩家的隊伍選擇，等待他們重新選
    players.forEach(p => {
        if (p.alive) p.team = '';
    });

    // 通知大螢幕更新回合數
    broadcastPlayerStats();
    // 通知大螢幕進入「等待選隊」狀態
    io.emit('resetScreenForNextRound', gameState.round);
}

// 需求(7) 特殊情況：如果贏家全部都選「否」(放棄)，顯示最後名單
function checkAllForfeit() {
    let activeSurvivors = 0;
    players.forEach(p => { if (p.alive) activeSurvivors++; });

    if (activeSurvivors === 0 && !gameState.isGameOver) {
        io.emit('allForfeit'); // 大螢幕顯示「所有贏家皆放棄」
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});