import { Router } from 'express';
import { onboardingController } from './onboarding.controller.js';

export const onboardingRouter = Router();

// Public routes for onboarding invitation verification and activation
onboardingRouter.get('/invite/:token', (req, res, next) => onboardingController.getInvite(req, res, next));
onboardingRouter.post('/activate', (req, res, next) => onboardingController.activate(req, res, next));
