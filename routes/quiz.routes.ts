import express from 'express';
import { createQuiz, deleteQuiz, editQuiz, getMyQuizzes, getAllQuizzes, startQuiz, submitQuizAnswers, getLeaderboard } from '../controllers/quiz.controller';
import { verifyToken } from '../middleware/verifyToken';

const router = express.Router();

// Create new quiz (requires authentication)
router.post('/create', verifyToken, createQuiz);
router.put('/edit/:id', verifyToken, editQuiz);
router.delete('/delete/:id', verifyToken, deleteQuiz);
router.get('/my-quizzes', verifyToken, getMyQuizzes);
router.get('/all', verifyToken, getAllQuizzes);
router.get('/leaderboard', verifyToken, getLeaderboard);

// Quiz participation endpoints
router.post('/:id/start', verifyToken, startQuiz);
router.post('/:id/submit', verifyToken, submitQuizAnswers);

export default router;