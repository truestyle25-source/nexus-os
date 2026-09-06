
import { Router } from 'express';
import { rhRoutes } from '../modules/rh/rh.routes';
import { pdvRoutes } from '../modules/pdv/pdv.routes';
// importe suas outras rotas existentes aqui

const router = Router();

router.use('/rh', rhRoutes);
router.use('/pdv', pdvRoutes);

export default router;
