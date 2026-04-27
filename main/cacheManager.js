const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class CacheManager {
    constructor(cacheDir) {
        this.cacheDir = cacheDir;
        this.stats = {
            hits: 0,
            misses: 0,
            totalSize: 0,
            fileCount: 0
        };
        fs.ensureDirSync(this.cacheDir);
        this.updateStats();
    }

    getHash(key) {
        return crypto.createHash('md5').update(key).digest('hex');
    }

    async get(key) {
        const hash = this.getHash(key);
        const filePath = path.join(this.cacheDir, `${hash}.json`);
        
        if (await fs.pathExists(filePath)) {
            this.stats.hits++;
            return await fs.readJson(filePath);
        }
        
        this.stats.misses++;
        return null;
    }

    async set(key, data) {
        const hash = this.getHash(key);
        const filePath = path.join(this.cacheDir, `${hash}.json`);
        await fs.writeJson(filePath, data);
        this.updateStats();
    }

    async updateStats() {
        try {
            const files = await fs.readdir(this.cacheDir);
            this.stats.fileCount = files.length;
            let totalSize = 0;
            for (const file of files) {
                const stats = await fs.stat(path.join(this.cacheDir, file));
                totalSize += stats.size;
            }
            this.stats.totalSize = totalSize;
        } catch (e) {
            console.error("Erreur lors de la mise à jour des stats du cache", e);
        }
    }

    getReport() {
        return {
            ...this.stats,
            totalSizeMB: (this.stats.totalSize / (1024 * 1024)).toFixed(2)
        };
    }

    async clear() {
        await fs.emptyDir(this.cacheDir);
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.updateStats();
    }
}

module.exports = CacheManager;
