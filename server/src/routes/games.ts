import { Router } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', '..', 'data');
const gamesData: Record<string, any> = JSON.parse(
  fs.readFileSync(path.join(dataPath, 'games', 'games.json'), 'utf-8')
);
const tagsData: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(dataPath, 'games', 'tags.json'), 'utf-8')
);

function addImageUrl(game: any) {
  return { ...game, imageUrl: `/data/games/header_images/${game.appId}.jpg` };
}

router.get('/tags', (_req, res) => {
  res.json(tagsData);
});

router.get('/:id', (req, res) => {
  const game = gamesData[req.params.id];
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  res.json(addImageUrl(game));
});

router.get('/', (req, res) => {
  const { search, tag, source } = req.query;
  let games = Object.values(gamesData);

  if (typeof search === 'string' && search) {
    const lower = search.toLowerCase();
    games = games.filter((g: any) => g.name.toLowerCase().includes(lower));
  }
  if (typeof tag === 'string' && tag) {
    const lower = tag.toLowerCase();
    games = games.filter((g: any) =>
      g.tags?.some((t: string) => t.toLowerCase() === lower)
    );
  }
  if (typeof source === 'string' && source) {
    games = games.filter((g: any) => g.source === source);
  }

  res.json(games.map(addImageUrl));
});

export default router;
