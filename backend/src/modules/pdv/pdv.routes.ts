
import { Router } from 'express';
import { pdvController } from './pdv.controller';
import { authMiddleware } from '../../middleware/auth';

const router = Router();
router.use(authMiddleware);

router.post('/caixa/abrir', pdvController.abrirCaixa);
router.post('/caixa/:id/fechar', pdvController.fecharCaixa);
router.get('/caixa/atual', pdvController.getCaixaAtual);
router.post('/vendas', pdvController.criarVenda);
router.get('/vendas', pdvController.listVendas);

export default router;
