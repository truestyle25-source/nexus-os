<<<<<<< HEAD
'use client';
import { useState } from 'react';
import api from '@/lib/api';

export default function LoginPage() {
  const [cadastro, setCadastro] = useState(false);
  const [form, setForm] = useState({nomeEmpresa:'',razaoSocial:'',cnpj:'',inscricaoEstadual:'',responsavelCpf:'',responsavelRg:'',cep:'',endereco:'',cidade:'',estado:'',nome:'',email:'',senha:''});
  const [log, setLog] = useState('');
  const set = (k:string,v:string)=>setForm(f=>({...f,[k]:v}));
  async function login(){ try { const {data}=await api.post('/auth/login',{email:form.email,senha:form.senha}); localStorage.setItem('token',data.token); window.location.href='/dashboard'; } catch(e:any){setLog(e.response?.data?.error||'Erro ao entrar');} }
  async function registrar(){ try { const {data}=await api.post('/auth/register-company',form); localStorage.setItem('token',data.token); setLog(`Empresa criada. Trial até ${new Date(data.trialFim).toLocaleDateString('pt-BR')}.`); window.location.href='/dashboard'; } catch(e:any){setLog(e.response?.data?.error||'Erro ao cadastrar empresa');} }
  const input=(key:string,placeholder:string)=><input value={(form as any)[key]} onChange={e=>set(key,e.target.value)} placeholder={placeholder} style={{width:'100%',padding:10,marginBottom:10}}/>;
  return <div style={{padding:40,maxWidth:460,margin:'0 auto'}}>
    <h1>NEXUS OS</h1><p>{cadastro?'Crie sua empresa e comece seu trial de 7 dias':'Acesse sua central de comando'}</p>
    {cadastro && <>{input('nomeEmpresa','Nome da empresa')}{input('razaoSocial','Razão Social')}{input('cnpj','CNPJ')}{input('inscricaoEstadual','Inscrição Estadual')}{input('responsavelCpf','CPF do responsável')}{input('responsavelRg','RG do responsável')}{input('cep','CEP')}{input('endereco','Endereço')}{input('cidade','Cidade')}{input('estado','Estado')}{input('nome','Nome do administrador')}</>}
    {input('email','E-mail corporativo')}
    <input type="password" value={form.senha} onChange={e=>set('senha',e.target.value)} placeholder="Senha (mín. 8 caracteres)" style={{width:'100%',padding:10,marginBottom:10}}/>
    <button onClick={cadastro?registrar:login} style={{width:'100%',padding:12,background:'#fff',color:'#000',fontWeight:'bold'}}>{cadastro?'CRIAR EMPRESA E INICIAR TRIAL':'ENTRAR NO NEXUS OS'}</button>
    <button onClick={()=>{setCadastro(!cadastro);setLog('')}} style={{width:'100%',padding:12,marginTop:10,background:'transparent',color:'#fff'}}>{cadastro?'Já tenho uma conta':'Criar minha empresa'}</button>
    <pre style={{marginTop:20,background:'#1a1a1a',padding:10,whiteSpace:'pre-wrap'}}>{log}</pre>
  </div>
=======
import AuthForm from '@/components/AuthForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-8">
      <AuthForm />
    </main>
  );
>>>>>>> 9a24c34c6d11c3f2872b796a0c1af740ba42af22
}
