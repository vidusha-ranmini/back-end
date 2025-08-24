import { Request, Response } from 'express';
import { PrismaClient } from '../prisma/generated/client';
import {QuizQuestion, CreateQuizRequest} from '../types';


const prisma = new PrismaClient();

// Helper function to check quiz ownership
const checkQuizOwnership = async (quizId: number, userId: number) => {
  const quiz = await prisma.quizzes.findUnique({
    where: { id: quizId },
    select: { user_id: true }
  });
  return quiz?.user_id === userId;
};

export const createQuiz = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId; // User info attached by middleware
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const quizData: CreateQuizRequest = req.body;

    // Validate required fields
    if (!quizData.name || !quizData.category || !quizData.description || !quizData.level || !quizData.time_limit) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate questions
    if (!quizData.questions || quizData.questions.length === 0) {
      return res.status(400).json({ error: 'Quiz must have at least one question' });
    }

    // Create quiz with transaction to ensure all related data is created
    const quiz = await prisma.$transaction(async (tx) => {
      // Create the quiz
      const newQuiz = await tx.quizzes.create({
        data: {
          name: quizData.name,
          category: quizData.category,
          description: quizData.description,
          level: quizData.level as any as import('../prisma/generated/client').quiz_difficulty_level,
          time_limit: quizData.time_limit,
          user_id: userId,
          question_count: quizData.questions.length,
        },
      });

      // Create questions for the quiz
      await tx.quizQuestion.createMany({
        data: quizData.questions.map(q => ({
          quiz_id: newQuiz.id,
          question: q.question,
          answers: q.answers,
          correct_answer: q.correct_answer,
          question_explanation: q.question_explanation,
        })),
      });

      return newQuiz;
    });

    res.status(201).json({
      message: 'Quiz created successfully',
      quiz: quiz
    });

  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
};

export const editQuiz = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const quizId = parseInt(req.params.id);
    if (isNaN(quizId)) {
      return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    // Check if the quiz exists and belongs to the user
    const hasAccess = await checkQuizOwnership(quizId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to edit this quiz' });
    }

    const quizData: Partial<CreateQuizRequest> = req.body;

    // Update quiz with transaction to ensure all related data is updated consistently
    const updatedQuiz = await prisma.$transaction(async (tx) => {
      // Update the quiz basic information
      const quiz = await tx.quizzes.update({
        where: { id: quizId },
        data: {
          name: quizData.name,
          category: quizData.category,
          description: quizData.description,
          time: quizData.time,
          level: quizData.level as any as import('../prisma/generated/client').quiz_difficulty_level,
          time_limit: quizData.time_limit,
          question_count: quizData.questions?.length || undefined,
        },
      });

      // If questions are provided, update them
      if (quizData.questions && quizData.questions.length > 0) {
        // Delete existing questions
        await tx.quizQuestion.deleteMany({
          where: { quiz_id: quizId },
        });

        // Create new questions
        await tx.quizQuestion.createMany({
          data: quizData.questions.map(q => ({
            quiz_id: quizId,
            question: q.question,
            answers: q.answers,
            correct_answer: q.correct_answer,
            question_explanation: q.question_explanation,
          })),
        });
      }

      return quiz;
    });

    res.status(200).json({
      message: 'Quiz updated successfully',
      quiz: updatedQuiz
    });

  } catch (error) {
    console.error('Error updating quiz:', error);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
};

export const deleteQuiz = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const quizId = parseInt(req.params.id);
    if (isNaN(quizId)) {
      return res.status(400).json({ error: 'Invalid quiz ID' });
    }

    // Check if the quiz exists and belongs to the user
    const hasAccess = await checkQuizOwnership(quizId, userId);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You do not have permission to delete this quiz' });
    }

    // Delete quiz with transaction to ensure all related data is deleted
    await prisma.$transaction(async (tx) => {
      // Delete all questions first
      await tx.quizQuestion.deleteMany({
        where: { quiz_id: quizId },
      });

      // Delete the quiz
      await tx.quizzes.delete({
        where: { id: quizId },
      });
    });

    res.status(200).json({
      message: 'Quiz deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting quiz:', error);
    res.status(500).json({ error: 'Failed to delete quiz' });
  }
};

export const getMyQuizzes = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get pagination parameters from query string
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const totalQuizzes = await prisma.quizzes.count({
      where: { user_id: userId }
    });

    // Get quizzes with their questions
    const quizzes = await prisma.quizzes.findMany({
      where: { user_id: userId },
      include: {
        questions: {
          select: {
            id: true,
            question: true,
            answers: true,
            correct_answer: true,
            question_explanation: true
          }
        }
      },
      skip,
      take: limit,
      orderBy: {
        created_at: 'desc'  // Most recent first
      }
    });

    res.status(200).json({
      quizzes,
      pagination: {
        total: totalQuizzes,
        page,
        limit,
        totalPages: Math.ceil(totalQuizzes / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
};

export const startQuiz = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const quizId = parseInt(req.params.id);
    if (isNaN(quizId)) {
      return res.status(400).json({ error: 'Invalid quiz ID' });
    }
    
    // Get the quiz with its questions
    const quiz = await prisma.quizzes.findUnique({
      where: { id: quizId },
      include: {
        questions: true
      }
    });
    
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    
    // Make sure we only return the correct number of questions based on question_count
    // If question_count is properly maintained, this should match the number of questions in the database
    if (quiz.questions && quiz.questions.length > quiz.question_count) {
      quiz.questions = quiz.questions.slice(0, quiz.question_count);
    }
    
    // Return the quiz with its questions to start the session
    res.status(200).json({
      message: 'Quiz started successfully',
      quiz: {
        ...quiz,
        isMyQuiz: quiz.user_id === userId
      }
    });
  } catch (error) {
    console.error('Error starting quiz:', error);
    res.status(500).json({ error: 'Failed to start quiz' });
  }
};

export const submitQuizAnswers = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const quizId = parseInt(req.params.id);
    if (isNaN(quizId)) {
      return res.status(400).json({ error: 'Invalid quiz ID' });
    }
    
    // Get submitted answers
    const { answers } = req.body;
    
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Invalid answers format' });
    }
    
    // Get the quiz with its questions to check answers
    const quiz = await prisma.quizzes.findUnique({
      where: { id: quizId },
      include: {
        questions: true
      }
    });
    
    if (!quiz) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    
    // Ensure we only use the actual number of questions (matching question_count)
    const actualQuestions = quiz.questions;
    if (actualQuestions.length > quiz.question_count) {
      actualQuestions.splice(quiz.question_count);
    }
    
    // Calculate score
    let correctCount = 0;
    const questionsMap = new Map(actualQuestions.map(q => [q.id, q]));
    
    for (const answer of answers) {
      const question = questionsMap.get(answer.questionId);
      if (question && question.correct_answer === answer.answer) {
        correctCount++;
      }
    }
    
    const score = correctCount;
    const totalQuestions = quiz.question_count; // Use the official question count
    
    // Record participation (optional, can be expanded)
    const participation = await prisma.quizParticipants.create({
      data: {
        quiz_id: quizId,
        user_id: userId,
        correct_question_count: correctCount,
        score: score,
      }
    });
    
    res.status(200).json({
      message: 'Quiz submitted successfully',
      score,
      totalQuestions,
      correctCount,
      participation
    });
  } catch (error) {
    console.error('Error submitting quiz answers:', error);
    res.status(500).json({ error: 'Failed to submit quiz answers' });
  }
};

export const getLeaderboard = async (req: Request, res: Response) => {
  try {
    // Get pagination parameters from query string
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    
    // Optional filter by quiz ID
    const quizId = req.query.quizId ? parseInt(req.query.quizId as string) : undefined;
    
    // Build where clause for filtering
    const whereClause: any = {};
    if (quizId) {
      whereClause.quiz_id = quizId;
    }
    
    // Get total count for pagination
    const totalParticipants = await prisma.quizParticipants.count({
      where: whereClause
    });
    
    // Get participants ordered by score
    const leaderboard = await prisma.quizParticipants.findMany({
      where: whereClause,
      orderBy: {
        score: 'desc' // Order by highest score first
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            profile_image: true
          }
        },
        quiz: {
          select: {
            id: true,
            name: true,
            level: true,
            question_count: true,
            category: true
          }
        }
      },
      skip,
      take: limit
    });
    
    // Transform the data to calculate ranking and percentages
    const transformedLeaderboard = leaderboard.map((entry, index) => {
      const maxPossibleScore = entry.quiz.question_count;
      const scorePercentage = maxPossibleScore > 0 
        ? (entry.score / maxPossibleScore) * 100 
        : 0;
      
      return {
        rank: skip + index + 1, // Calculate rank based on pagination
        userId: entry.user_id,
        username: entry.user.username,
        profileImage: entry.user.profile_image,
        quizId: entry.quiz_id,
        quizName: entry.quiz.name,
        quizCategory: entry.quiz.category,
        quizLevel: entry.quiz.level,
        score: entry.score,
        maxScore: maxPossibleScore,
        scorePercentage: Math.round(scorePercentage * 10) / 10, // Round to 1 decimal place
        correctQuestions: entry.correct_question_count,
        totalQuestions: entry.quiz.question_count
      };
    });
    
    res.status(200).json({
      leaderboard: transformedLeaderboard,
      pagination: {
        total: totalParticipants,
        page,
        limit,
        totalPages: Math.ceil(totalParticipants / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
};

export const getAllQuizzes = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId; // User info attached by middleware
    
    // Get pagination parameters from query string
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    
    // Get category filter if provided
    const category = req.query.category as string | undefined;
    const level = req.query.level as string | undefined;
    const search = req.query.search as string | undefined;
    
    // Build where clause for filtering
    const whereClause: any = {
      // Add filters if provided
      ...(category && { category }),
      ...(level && { level }),
      ...(search && { 
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      }),
    };
    
    // Get total count for pagination
    const totalQuizzes = await prisma.quizzes.count({
      where: whereClause
    });
    
    // Get all quizzes with limited information (no questions)
    const quizzes = await prisma.quizzes.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        question_count: true,
        level: true,
        time_limit: true,
        user_id: true,
        created_at: true,
        // Count participants instead of including them
        _count: {
          select: {
            participants: true
          }
        }
      },
      skip,
      take: limit,
      orderBy: {
        created_at: 'desc'  // Most recent first
      }
    });
    
    // Transform the results to add isMyQuiz flag
    const transformedQuizzes = quizzes.map(quiz => ({
      ...quiz,
      participants_count: quiz._count.participants,
      isMyQuiz: quiz.user_id === userId,
      _count: undefined, // Remove the _count property
    }));
    
    res.status(200).json({
      quizzes: transformedQuizzes,
      pagination: {
        total: totalQuizzes,
        page,
        limit,
        totalPages: Math.ceil(totalQuizzes / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching all quizzes:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
};
