import cors from 'cors';
import express from 'express';
import path from 'path';
import { __dirname } from './config.js';

export function setupMiddleware(app) {
  app.use(cors());
  app.use(express.json());
  // No-cache for HTML (force fresh SPA loads), cache assets by hash
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
  });
  // Serve static assets but NOT index.html (let routes.js handle / with onboarding gate)
  app.use(express.static(path.join(__dirname, 'dist'), { index: false }));
}
