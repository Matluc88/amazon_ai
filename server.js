require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Assicura che la cartella uploads esista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const uploadRoutes = require('./routes/upload');
const productsRoutes = require('./routes/products');
const listingsRoutes = require('./routes/listings');
const keywordsRoutes = require('./routes/keywords');

app.use('/api/upload', uploadRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/keywords', keywordsRoutes);

// Fallback per le pagine HTML
app.get('/listing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'listing.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Amazon AI Listing Tool avviato su http://localhost:${PORT}`);
});
