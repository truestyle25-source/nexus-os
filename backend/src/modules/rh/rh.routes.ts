
import { Router } from 'express';
import { rhController } from './rh.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.get('/funcionarios', rhController.listFuncionarios);
router.post('/funcionarios', rhController.createFuncionario);
router.put('/funcionarios/:id', rhController.updateFuncionario);
router.delete('/funcionarios/:id', rhController.deleteFuncionario);
router.get('/ponto', rhController.listPonto);
router.post('/ponto', rhController.registrarPonto);

export default router;
