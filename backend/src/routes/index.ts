import { Router } from 'express';
import rhRoutes from '../modules/rh/rh.routes';
import pdvRoutes from '../modules/pdv/pdv.routes';

const router = Router();
router.use('/rh', rhRoutes);
router.use('/pdv', pdvRoutes);

export { rhRoutes, pdvRoutes };
export default router;
