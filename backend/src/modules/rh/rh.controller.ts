
import { Request, Response } from 'express';
import { rhService } from './rh.service.js';

export const rhController = {
  async listFuncionarios(req: Request, res: Response) {
    const data = await rhService.listFuncionarios();
    res.json(data);
  },
  async createFuncionario(req: Request, res: Response) {
    const data = await rhService.createFuncionario(req.body);
    res.status(201).json(data);
  },
  async updateFuncionario(req: Request, res: Response) {
    const data = await rhService.updateFuncionario(req.params.id, req.body);
    res.json(data);
  },
  async deleteFuncionario(req: Request, res: Response) {
    await rhService.deleteFuncionario(req.params.id);
    res.status(204).send();
  },
  async listPonto(req: Request, res: Response) {
    const data = await rhService.listPonto();
    res.json(data);
  },
  async registrarPonto(req: Request, res: Response) {
    const data = await rhService.registrarPonto(req.body);
    res.json(data);
  }
};
