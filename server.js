const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.static(__dirname));

// Data global playlist (akan tersimpan di memory server)
let playlist = [
    { id: Date.now() + 1, title: "L'Arc~en~Ciel - HONEY", videoId: "G7gI8WZriO0", isBlacklisted: false, addedBy: "system" },
    { id: Date.now() + 2, title: "Sam Lee - 痴心絕對", videoId: "K_WOoQsf7sk", isBlacklisted: false, addedBy: "system" }
];
let currentIndex = 0;
let adminLoggedIn = false;

function extractVideoId(url) {
    if (!url) return null;
    const regex = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function fetchVideoTitle(videoId) {
    try {
        const https = require('https');
        return new Promise((resolve) => {
            https.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.title || `Video ${videoId}`);
                    } catch(e) {
                        resolve(`YouTube Video ${videoId}`);
                    }
                });
            }).on('error', () => resolve(`Video ${videoId}`));
        });
    } catch(e) {
        return `Video ${videoId}`;
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('init', { playlist, currentIndex });
    
    socket.on('add-song', async (data) => {
        const { url, addedBy } = data;
        const videoId = extractVideoId(url);
        if (videoId && !playlist.find(p => p.videoId === videoId)) {
            const title = await fetchVideoTitle(videoId);
            playlist.push({ id: Date.now(), title, videoId, isBlacklisted: false, addedBy: addedBy || 'user' });
            io.emit('playlist-updated', { playlist, currentIndex });
            console.log(`Song added: ${title} by ${addedBy}`);
        }
    });
    
    socket.on('admin-next', () => {
        if (adminLoggedIn && playlist.length) {
            let nextIdx = (currentIndex + 1) % playlist.length;
            let attempts = 0;
            while (playlist[nextIdx]?.isBlacklisted && attempts < playlist.length) {
                nextIdx = (nextIdx + 1) % playlist.length;
                attempts++;
            }
            if (playlist[nextIdx] && !playlist[nextIdx].isBlacklisted) {
                currentIndex = nextIdx;
                io.emit('playlist-updated', { playlist, currentIndex });
                console.log('Admin: Next song');
            }
        }
    });
    
    socket.on('admin-remove', (songId) => {
        if (adminLoggedIn) {
            const idx = playlist.findIndex(s => s.id === songId);
            if (idx !== -1) {
                const wasPlaying = idx === currentIndex;
                playlist.splice(idx, 1);
                if (playlist.length === 0) {
                    currentIndex = 0;
                } else if (wasPlaying) {
                    if (currentIndex >= playlist.length) currentIndex = playlist.length - 1;
                } else if (currentIndex > idx) {
                    currentIndex--;
                }
                io.emit('playlist-updated', { playlist, currentIndex });
                console.log('Admin: Removed song, new playlist length:', playlist.length);
            }
        }
    });
    
    socket.on('admin-blacklist', (songId) => {
        if (adminLoggedIn) {
            const song = playlist.find(s => s.id === songId);
            if (song) {
                song.isBlacklisted = !song.isBlacklisted;
                if (song.isBlacklisted && playlist[currentIndex]?.id === song.id) {
                    let nextIdx = (currentIndex + 1) % playlist.length;
                    let attempts = 0;
                    while (playlist[nextIdx]?.isBlacklisted && attempts < playlist.length) {
                        nextIdx = (nextIdx + 1) % playlist.length;
                        attempts++;
                    }
                    if (playlist[nextIdx] && !playlist[nextIdx].isBlacklisted) {
                        currentIndex = nextIdx;
                    }
                }
                io.emit('playlist-updated', { playlist, currentIndex });
                console.log(`Admin: ${song.isBlacklisted ? 'Blacklisted' : 'Unblacklisted'} ${song.title}`);
            }
        }
    });
    
    socket.on('admin-move', ({ songId, direction }) => {
        if (adminLoggedIn) {
            const idx = playlist.findIndex(s => s.id === songId);
            if (idx !== -1) {
                const newIdx = direction === 'up' ? idx - 1 : idx + 1;
                if (newIdx >= 0 && newIdx < playlist.length) {
                    [playlist[idx], playlist[newIdx]] = [playlist[newIdx], playlist[idx]];
                    if (currentIndex === idx) currentIndex = newIdx;
                    else if (currentIndex === newIdx) currentIndex = idx;
                    io.emit('playlist-updated', { playlist, currentIndex });
                }
            }
        }
    });
    
    socket.on('admin-play-now', (index) => {
        if (adminLoggedIn && playlist[index] && !playlist[index].isBlacklisted) {
            currentIndex = index;
            io.emit('playlist-updated', { playlist, currentIndex });
            console.log('Admin: Play specific song at index', index);
        }
    });
    
    socket.on('admin-login', (password) => {
        if (password === 'anakbandot') {
            adminLoggedIn = true;
            socket.emit('admin-login-success');
            io.emit('admin-status-changed', { isAdminLoggedIn: true });
            console.log('✅ Admin logged in successfully');
        } else {
            socket.emit('admin-login-failed');
            console.log('❌ Admin login failed with password:', password);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🎵 Server running on port ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`🔑 Admin password: anakbandot\n`);
});