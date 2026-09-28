export interface Example {
  name: string;
  specialty: string;
  scene: string;
  request: string;
  answer: string;
  work: string;
  title: string;
  subtitle: string;
  closing: string;
  document: string;
}

export const examples: Record<string, Example> = {
  vera: {
    name: "Vera",
    specialty: "Um olhar cuidadoso para suas palavras.",
    scene: "Uma ideia, uma conversa",
    request: "Vera, transforma essa ideia em um post? Quero apresentar o nod de um jeito simples, sem parecer uma propaganda.",
    answer: "Claro. Vou partir do que ele faz no dia a dia e manter o tom direto que você gosta.",
    work: "Organizei a ideia e preparei um primeiro rascunho.",
    title: "Um primeiro oi do nod",
    subtitle: "Rascunho de post · pronto para você revisar",
    closing: "Se quiser, também posso deixar mais curto.",
    document: "<p>Tem uma ideia que você quer tirar do papel, mas que sempre acaba ficando para depois?</p><p>Estamos criando o nod para ajudar com isso. Nele, você cria bots com funções próprias, compartilha o contexto e trabalha com eles por conversa.</p><p>Um para ajudar com os textos. Outro para organizar as ideias. Mais um para aquela rotina que precisa acontecer toda semana.</p><p>O nod ainda está em desenvolvimento. Este é só o nosso primeiro oi.</p>",
  },
  lume: {
    name: "Lume",
    specialty: "Um pouco de curiosidade faz a ideia andar.",
    scene: "Um projeto, novos caminhos",
    request: "Lume, quero começar uma newsletter sobre o que estou construindo. Me ajuda a encontrar um formato simples?",
    answer: "Vamos começar pequeno. Separei três formatos para você escolher o que combina com o seu ritmo.",
    work: "Organizei as possibilidades e um primeiro passo para cada uma.",
    title: "Três jeitos de começar",
    subtitle: "Ideias de formato · para pensar junto",
    closing: "Qual desses dá mais vontade de colocar no mundo?",
    document: "<p><strong>01. Uma descoberta por semana.</strong><br>Uma coisa que você aprendeu construindo o projeto, contada em cinco parágrafos. Primeiro passo: escolher uma descoberta de hoje.</p><p><strong>02. Pequeno diário de construção.</strong><br>O que mudou, uma decisão e a próxima pergunta. Primeiro passo: anotar três coisas que aconteceram nesta semana.</p><p><strong>03. Uma conversa por edição.</strong><br>Partir de uma pergunta que alguém fez e compartilhar o seu raciocínio. Primeiro passo: recuperar uma pergunta que fez você pensar.</p>",
  },
  nico: {
    name: "Nico",
    specialty: "Transforma uma ideia de projeto em próximos passos.",
    scene: "Uma ideia, um plano possível",
    request: "Nico, quero fazer um site para meu projeto. Me ajuda a organizar o que precisa entrar na primeira versão?",
    answer: "Vamos definir uma primeira versão pequena. Ela precisa explicar a ideia, mostrar um exemplo e dar um próximo passo a quem visitar.",
    work: "Separei o essencial para começar e o que pode esperar.",
    title: "O primeiro site do projeto",
    subtitle: "Plano inicial · quatro passos para começar",
    closing: "Podemos começar pela frase que apresenta o projeto.",
    document: "<p><strong>1. Explique a ideia em uma frase.</strong><br>Para quem é o projeto e o que ele ajuda a fazer?</p><p><strong>2. Mostre uma situação concreta.</strong><br>Escolha um exemplo que comece com um pedido e termine com uma entrega compreensível.</p><p><strong>3. Conte em que estágio está.</strong><br>O que já funciona, o que está em construção e como as pessoas podem acompanhar.</p><p><strong>4. Revise no celular.</strong><br>Confirme que a mensagem, a demonstração e o convite funcionam em uma tela pequena.</p>",
  },
  bia: {
    name: "Bia",
    specialty: "Cuida dos combinados que se repetem.",
    scene: "Uma segunda-feira com um começo",
    request: "Bia, toda segunda às 9h, prepare três ideias de conteúdo a partir do briefing que te passei.",
    answer: "Combinado. Preparei uma proposta de rotina para as segundas, às 9h, no horário de São Paulo. Você pode revisar antes de ativar.",
    work: "A proposta está pronta, aguardando sua confirmação.",
    title: "Ideias para começar a semana",
    subtitle: "Proposta de rotina · segundas às 09:00",
    closing: "Você pode ajustar ou pausar a rotina quando quiser.",
    document: "<p><strong>O que fazer</strong><br>Preparar três ideias de conteúdo com base no briefing compartilhado na conversa.</p><p><strong>Quando</strong><br>Toda segunda-feira, às 09:00, no fuso America/Sao_Paulo.</p><p><strong>Onde receber</strong><br>Na conversa com a Bia.</p><p><strong>Antes de começar</strong><br>No aplicativo, você revisa e confirma a proposta. Na configuração local, a rotina depende do computador e do nod ligados.</p>",
  },
};
