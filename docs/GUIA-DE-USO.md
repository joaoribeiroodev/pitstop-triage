# PitStop: guia de primeiro uso

Este guia mostra o caminho do zero até a primeira ordem de serviço entregue. São dois sites, com logins diferentes.

| Site           | Quem usa                   | Para quê                                                    |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| Painel admin   | Equipe do PitStop (você)   | Criar oficinas, definir plano e módulos, suspender, suporte |
| App da oficina | Dono, recepção e mecânicos | Clientes, triagem, ordens de serviço e orçamento            |

O cliente final (motorista) não tem login: ele recebe um link e abre o portal no celular.

## 1. Criar a oficina (painel admin)

1. Entre no painel admin com o seu usuário de super admin.
2. Clique em **Nova oficina** e siga as quatro etapas: dados da oficina, plano, proprietário e revisão.
3. Na etapa do proprietário, defina uma **senha inicial**. Sem senha, o proprietário recebe um convite por e-mail.
4. Depois de criada, a tela da oficina permite ligar e desligar módulos, ajustar limites, suspender e abrir uma sessão de suporte.

Um usuário de super admin não pertence a nenhuma oficina. Se ele tentar entrar no app da oficina, verá a tela de acesso bloqueado.

## 2. Preparar a oficina (app da oficina, como proprietário)

O **Painel** mostra o cartão **Primeiros passos** até os três itens estarem feitos:

1. **Cadastre a equipe** em Ajustes → Usuários. Os papéis são:
   - **Proprietário**: tudo, inclusive usuários e preferências.
   - **Gerente**: toda a operação e o catálogo, sem gerenciar usuários.
   - **Recepção**: clientes, veículos, triagem, abertura de OS e envio de orçamento.
   - **Mecânico**: as ordens atribuídas a ele (ou a fila toda, se a oficina preferir), diagnóstico e execução.
2. **Monte o catálogo** em Ajustes → Catálogo de serviços e peças. Os preços padrão entram no orçamento com um toque.
3. **Abra a primeira triagem.**

## 3. O atendimento, do relato à entrega

### Triagem (recepção)

Em **Triagem → Nova triagem**, cinco etapas:

1. **Carro**: busque por placa, nome ou telefone. Se não existir, cadastre o cliente e o veículo ali mesmo.
2. **Mapa**: escolha onde está o problema, clicando no carro 3D ou nos atalhos ao lado.
3. **Sintomas**: marque o que o cliente descreveu. Para outra parte do carro, volte ao mapa: o que já foi marcado fica guardado.
4. **Detalhes**: perguntas curtas sobre cada sintoma. Todas são opcionais.
5. **Resumo**: confira, salve e abra a ordem de serviço.

Também dá para enviar ao cliente o **link de triagem** (botão na tela Triagem). Ele preenche em casa e o relato aparece como pendente.

### Ordem de serviço

A OS tem quatro abas, na ordem do atendimento:

- **Sintomas**: o relato do cliente.
- **Diagnóstico**: a análise do mecânico e, ao lado, as **sugestões para considerar** (causas, verificações e peças). Elas vêm do catálogo técnico e do histórico da própria oficina, nunca são obrigatórias e podem ser ignoradas com um botão.
- **Orçamento**: itens de mão de obra e peças. A recepção gera o **link de aprovação**, copia a mensagem pronta ou abre no WhatsApp.
- **Timeline**: tudo o que aconteceu, com autor e horário.

O status anda assim: Rascunho → Em diagnóstico → Aguardando aprovação → Aprovada → Em execução → Concluída → Entregue. O envio e a resposta do orçamento mudam o status sozinhos; os demais passos têm um botão no topo da OS ou podem ser feitos arrastando o cartão no quadro **Ordens**.

### Portal do cliente

Pelo link, o cliente vê o veículo, o andamento, o orçamento item a item e os botões **Aprovar** e **Recusar**. Ele nunca vê o diagnóstico interno, as sugestões nem preços de custo. Se o cliente responder por telefone, a recepção registra a resposta na aba Orçamento.

## 4. Dia a dia

- **Painel**: indicadores do dia e a lista **Precisam de você**, com o que espera ação do seu papel.
- **Ordens**: o quadro com todas as OS por etapa.
- **Clientes** e **Veículos**: cadastro e histórico completo de cada carro.
- **LGPD**: na ficha do cliente, o proprietário pode exportar os dados ou anonimizar o cadastro.
