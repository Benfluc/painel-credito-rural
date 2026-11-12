# 🌱 Painel do Crédito Rural no Brasil

Dashboard interativo, aberto e gratuito sobre as contratações de **crédito rural no Brasil**, com dados oficiais da
[Matriz de Dados do Crédito Rural (SICOR/Banco Central)](https://dadosabertos.bcb.gov.br/dataset/matrizdadoscreditorural).

Explore **custeio, investimento, comercialização e industrialização** do Brasil inteiro até o município. Os recortes
disponíveis são ano, atividade (agrícola/pecuária), programa (Pronaf, Pronamp, RenovAgro…) e métrica (valor, número de
contratos ou valor médio).

## Funcionalidades

- **Mapa coroplético** (MapLibre GL) com navegação Brasil → estado → município, hover e clique para detalhar
- Alternância **estados / municípios** no nível nacional (5,5 mil polígonos renderizados em WebGL)
- **KPIs**: valor contratado, contratos, ticket médio, área financiada, participação no Brasil e variação contra o
  *mesmo período* do ano anterior (para não comparar ano parcial com ano fechado)
- **Ranking** de estados ou municípios, com clique para selecionar
- **Série mensal** e **série histórica anual** empilhadas por finalidade
- Quebras por **programa**, **fonte de recursos**, **sexo do beneficiário**, **produtos financiados** e **instituições
  financeiras** (com segmento)
- **Consulta ao vivo no BCB** ao escolher um município: série mensal e produtos de custeio/investimento vêm direto da API
- **Busca de município** com autocompletar (ignora acentos)
- **URL compartilhável**: todo filtro fica na URL (`?ano=2025&uf=31&mun=3143302&at=1`)
- Responsivo, tema escuro, respeita `prefers-reduced-motion`

## Arquitetura

```mermaid
flowchart LR
  BCB[(API OData SICOR\nolinda.bcb.gov.br)]
  GA[GitHub Actions\ncron diário]
  ETL[etl/sicor_etl.py\ncoleta + agrega]
  JSON[public/data/*.json\nagregados compactos]
  VC[Vercel\nsite estático + CDN]
  FN[/api/municipio\n/api/status/]
  UI[Dashboard React]

  BCB --> ETL
  GA --> ETL --> JSON --> VC --> UI
  UI -- município selecionado --> FN -- consulta ao vivo + cache --> BCB
```

**Por que híbrido?** A API do SICOR é lenta (às vezes dezenas de segundos), devolve HTTP 500 de forma intermitente e um
único mês da base municipal passa de 10 MB. Consultar tudo pelo navegador a cada filtro tornaria o painel inutilizável.
Por isso:

1. **ETL diário** (`etl/sicor_etl.py`, só biblioteca padrão do Python) consulta a API mês a mês, agrega e grava JSONs
   compactos. Ele reconsulta os **3 meses mais recentes** a cada execução, porque os registros chegam com atraso.
2. **Funções serverless** (`api/`) consultam o BCB **ao vivo** para o detalhe de um município e para o status da fonte,
   com cache de CDN (6 h no ano corrente, 7 dias em anos fechados).

O dashboard mostra a data da última sincronização e avisa quando o BCB já publicou um mês que o painel ainda não tem.

### Arquivos gerados (`public/data`)

| Arquivo | Conteúdo | Fonte (entidade OData) |
|---|---|---|
| `meta.json` | anos, meses disponíveis, dicionários | — |
| `serie_anual.json` | ano × UF × atividade × programa | `RegiaoUF` |
| `uf_AAAA.json` | mês × UF × atividade × programa × fonte | `RegiaoUF` |
| `mun_AAAA.json` | município × atividade × programa (+ área) | `CusteioInvestimentoComercialIndustrialSemFiltros` |
| `prod_AAAA.json` | UF × finalidade × produto × atividade × programa | `Custeio/Invest/ComercRegiaoUFProduto` |
| `if_AAAA.json` | UF × instituição × segmento × atividade × programa | `SegmentoIFRegiaoUF` |
| `gen_AAAA.json` | UF × sexo × atividade × programa | `RegiaoUFGenero` |

Cada linha traz quantidade e valor para as 4 finalidades.

## Como publicar (Vercel + GitHub)

1. Crie um repositório (ex.: `Benfluc/painel-credito-rural`) e envie esta pasta:
   ```bash
   git init && git add . && git commit -m "Painel do Crédito Rural"
   git branch -M main
   git remote add origin https://github.com/Benfluc/painel-credito-rural.git
   git push -u origin main
   ```
2. No GitHub, abra **Settings → Actions → General → Workflow permissions** e marque **Read and write permissions**
   (o ETL faz commit dos dados).
3. Em **Actions → "Atualizar dados do SICOR" → Run workflow**, rode a primeira carga com `inicio = 2013`.
   A carga completa leva de 1 a 3 horas, por causa da lentidão da API. Se cair no meio, rode de novo: o cache mensal
   continua de onde parou.
4. Na [Vercel](https://vercel.com/new), importe o repositório. O preset **Vite** é detectado sozinho e não precisa de
   variáveis de ambiente. Cada commit do ETL gera um novo deploy.

> Antes da primeira carga, o painel funciona em **modo amostra**: são respostas reais do BCB gravadas para teste
> (estados 2022–2023; municípios e produtos só jan/2023), e um aviso amarelo fica visível no topo.

## Rodando localmente

```bash
npm install
npm run dev                     # http://localhost:5173  (sem /api: a consulta ao vivo tenta o BCB direto)
npx vercel dev                  # inclui as funções /api
python3 etl/sicor_etl.py --inicio 2023 --out public/data   # coleta real (precisa de acesso ao BCB)
```

Opções do ETL: `--inicio`, `--fim`, `--refresh N` (meses recentes a reconsultar), `--workers`, `--so-gerar`
(só regenera os JSONs a partir do cache) e `--fixtures DIR` (lê respostas gravadas).

## Metodologia e limites

- Valores **nominais** (sem correção pela inflação), pela **data de emissão** do contrato.
- **Programas agrupados**: Pronaf (0001), Pronamp (0050), Sem vínculo (0999), RenovAgro/ABC+ (0156, 0222, 0180) e Outros.
- **Fontes agrupadas**: obrigatórios, poupança rural, LCA, livres, fundos constitucionais, BNDES/Finame e outras.
- Fonte de recursos, produtos, instituições e sexo são publicados **por UF**. Ao escolher um município, esses gráficos
  mostram o estado dele.
- **Sexo do beneficiário**: códigos 1 e 2 tratados como masculino e feminino; demais códigos agrupados como
  "PJ / não informado".
- A malha municipal (IBGE, simplificada) não tem os municípios criados mais recentemente, e o polígono de Paraty (RJ)
  está incompleto na base de origem. Esses municípios aparecem no ranking e na busca, mas não no mapa.
- **Conferência**: com respostas reais da API, os totais de 2022 e 2023 por finalidade batem com a soma oficial
  (contratos exatos; valores com diferença de poucos reais, por arredondamento).

## Stack

React 18 · TypeScript · Vite · Tailwind CSS 4 · MapLibre GL · Recharts · Framer Motion · Vercel Functions · Python (ETL)

## Créditos e licença

- Dados: **Banco Central do Brasil**, licença [ODbL](https://opendatacommons.org/licenses/odbl/)
- Malha municipal: IBGE, via [tbrugz/geodata-br](https://github.com/tbrugz/geodata-br)
- Respostas de amostra da API: gravadas pelo projeto [agrobr](https://github.com/bruno-portfolio/agrobr)
- Código: MIT, © Lúcio Júnio Benfica Rosa
