import { Router } from 'express';
import rhRoutes from '../modules/rh/rh.routes.js';
import pdvRoutes from '../modules/pdv/pdv.routes.js';

const router = Router();
router.use('/rh', rhRoutes);
router.use('/pdv', pdvRoutes);

export { rhRoutes, pdvRoutes };
export default router;
