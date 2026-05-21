// semantic-db.js
const DB_NAME = 'EduSearchSemanticDB';
const DB_VERSION = 1;
const STORE_NAME = 'embeddings';

class SemanticDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('articleId', 'articleId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveChunks(articleId, chunks, embeddings) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            chunks.forEach((text, index) => {
                store.put({
                    id: `${articleId}_${index}`,
                    articleId: articleId,
                    chunkIndex: index,
                    text: text,
                    vector: embeddings[index]
                });
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(event.target.error);
        });
    }

    async hasArticle(articleId) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index('articleId');
            const request = index.count(articleId);

            request.onsuccess = () => resolve(request.result > 0);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async getAllEmbeddings(targetArticleId = null) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            
            let request;
            if (targetArticleId !== null) {
                const index = store.index('articleId');
                // Если передан ID, используем индекс. Если ID = -999, вернет пустой список.
                request = index.getAll(IDBKeyRange.only(targetArticleId));
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

window.semanticDB = new SemanticDB();