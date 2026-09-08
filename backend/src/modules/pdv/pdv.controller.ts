
import { Request, Response } from 'express';
import { pdvService } from './pdv.service';

export const pdvController = {
  async abrirCaixa(req: Request, res: Response) {
    const data = await pdvService.abrirCaixa(req.body);
    res.status(201).json(data);
  },
  async fecharCaixa(req: Request, res: Response) {
    const data = await pdvService.fecharCaixa(req.params.id, req.body);
    res.json(data);
  },
  async getCaixaAtual(req: Request, res: Response) {
    const data = await pdvService.getCaixaAtual();
    res.json(data);
  },
  async criarVenda(req: Request, res: Response) {
    const data = await pdvService.criarVenda(req.body);
    res.status(201).json(data);
  },
  async listVendas(req: Request, res: Response) {
    const data = await pdvService.listVendas();
    res.json(data);
  }
};
