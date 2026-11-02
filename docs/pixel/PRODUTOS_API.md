# Estokfy Pixel: API de produtos

Para quem desenvolve a loja online do cliente. A API recebe os produtos e os
cadastra no Estokfy do mesmo jeito que o cadastro manual: mesma tabela de
produtos, mesmas categorias, mesmo estoque inicial.

## Endpoint

```
POST {BASE_URL}/functions/v1/pixel-products
```

Headers:

| Header | Valor |
|---|---|
| `Content-Type` | `application/json` |
| `x-pixel-id` | Pixel ID (em Estokfy Pixel → Configuração) |
| `x-pixel-key` | Secret Key (mesma tela) |

Guarde a Secret Key no servidor da loja, nunca no navegador.

## Corpo

```json
{
  "products": [
    {
      "external_id": "PROD-123",
      "name": "Camiseta Básica",
      "sku": "CAM-BAS",
      "barcode": "7890000000001",
      "brand": "Marca X",
      "model": "Básica",
      "category": "Roupas",
      "cost_price": 20.0,
      "sale_price": 59.9,
      "minimum_stock": 2,
      "stock": 10,
      "is_active": true,
      "variations": [
        {
          "external_id": "VAR-123-P-AZ",
          "sku": "CAM-P-AZ",
          "barcode": "7890000000002",
          "attributes": { "tamanho": "P", "cor": "Azul" },
          "stock": 5
        }
      ]
    }
  ]
}
```

Campos de cada item:

| Campo | Obrigatório | Observação |
|---|---|---|
| `external_id` | sim | Id do produto na loja online. É a chave de reenvio. |
| `name` | sim | Nome do produto. |
| `sku` | não | Único por loja no Estokfy. |
| `barcode` | não | Único por loja no Estokfy. |
| `brand`, `model` | não | Texto livre. |
| `category` | não | Nome da categoria. Se não existir, é criada. Maiúsculas e minúsculas não diferenciam. |
| `cost_price`, `sale_price` | não | Número maior ou igual a zero. Produto novo começa em 0. |
| `minimum_stock` | não | Inteiro maior ou igual a zero. |
| `stock` | não | Inteiro maior ou igual a zero. **Só vale para produto novo.** |
| `is_active` | não | `true` por padrão. |
| `variations` | não | Lista de variações. Veja abaixo. |

Máximo de **200 itens por chamada**. Se a loja tiver mais, envie em lotes.

## Variações

O Estokfy não tem variações: cada uma vira um **produto separado**, com seu
próprio SKU, código de barras, preço e estoque.

- A variação herda do pai a marca, o modelo, a categoria, o custo, o preço
  de venda, o estoque mínimo e o status, quando não informar os seus.
- O pai com variações **não** vira produto: só as variações entram.
- O nome da variação é o que ela informar em `name`. Se não informar, o nome
  é o do pai com os atributos: `Camiseta Básica - P / Azul`.
- Cada variação precisa de `external_id`.

## Regras

**Reenvio não duplica.** Um produto é identificado nesta ordem:
1. pelo `external_id` (já ligado a este produto);
2. pelo `sku` (quando o produto ainda não tem `external_id`);
3. pelo `barcode`, com a mesma regra.

Se nada bater, o produto é criado.

**Estoque é do Estokfy.** O `stock` só vale na criação. Produto que já existe
nunca tem o estoque alterado pela API: vendas, entradas e ajustes continuam no
Estokfy. Assim, o estoque da loja física não é sobrescrito.

**Campo ausente não apaga.** Se um reenvio não traz `brand`, a marca que já
está no Estokfy fica como está. Para limpar um campo, não há como pela API:
faça pelo cadastro do produto.

**SKU ou código de barras de outro produto não é sobrescrito.** Se o SKU já
pertence a um produto ligado a outro `external_id`, o item vem com erro, e os
demais são gravados normalmente.

**Fotos não são importadas.** Cadastre pelas fotos no Estokfy.

## Resposta

```json
{
  "status": "partial",
  "created": 1,
  "updated": 1,
  "errors": 1,
  "results": [
    { "external_id": "PROD-123", "action": "created", "product_id": "..." },
    { "external_id": "PROD-124", "action": "updated", "product_id": "..." },
    { "external_id": "PROD-125", "action": "error", "error": "sku_ja_ligado_a_outro_produto_da_loja_online" }
  ]
}
```

- `status`: `success` (tudo gravado) ou `partial` (há itens com erro).
- `results`: um item por produto enviado (inclusive variações), na mesma ordem.

Erros por item (campo `error` em `results`):

| Código | Quando |
|---|---|
| `external_id_obrigatorio` | Item sem `external_id`. |
| `nome_obrigatorio` | Item sem `name`. |
| `custo_invalido`, `preco_invalido` | Preço negativo. |
| `estoque_minimo_invalido`, `estoque_invalido` | Número negativo. |
| `sku_ja_ligado_a_outro_produto_da_loja_online` | SKU de outro produto da loja online. |
| `barcode_ja_ligado_a_outro_produto_da_loja_online` | Código de barras de outro produto. |

Erros da chamada inteira:

| HTTP | `error` | Quando |
|---|---|---|
| 401 | `invalid_pixel`, `invalid_signature` | Pixel ID ou Secret Key errados. |
| 403 | `pixel_inactive` | Pixel desativado no Estokfy. |
| 400 | `invalid_json`, `invalid_payload` | Corpo que não é JSON ou sem a lista `products`. |
| 400 | `batch_too_large` | Mais de 200 itens, ou mais de 500 depois de expandir as variações. |

## Exemplo

```javascript
const res = await fetch(`${BASE_URL}/functions/v1/pixel-products`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-pixel-id": process.env.ESTOKFY_PIXEL_ID,
    "x-pixel-key": process.env.ESTOKFY_PIXEL_KEY,
  },
  body: JSON.stringify({ products: lote }), // até 200 itens
});
const out = await res.json();
const falhas = out.results?.filter((r) => r.action === "error") ?? [];
```

Teste com `curl` antes de integrar:

```bash
curl -X POST "$BASE_URL/functions/v1/pixel-products" \
  -H "Content-Type: application/json" \
  -H "x-pixel-id: $ESTOKFY_PIXEL_ID" \
  -H "x-pixel-key: $ESTOKFY_PIXEL_KEY" \
  -d '{"products":[{"external_id":"TESTE-1","name":"Produto de teste","sale_price":10,"stock":1}]}'
```
