# Exemplos de uso deste script:
# 
# Enviar evento payment_processing com instruções de pagamento:
# python send_order_update.py payment_processing --order-id=999 --client-id=TESTE --input-asset=BRL --input-amount=123.45 --output-asset=USDT --output-amount-net=17 --network=BSC --wallet-address=TESTE_WALLET
#
# Enviar evento order_concluded com payout_identifier:
# python send_order_update.py order_concluded --order-id=123 --input-asset=BRL --input-amount=1050 --output-asset=USDT --output-amount-net=20.5 --payout-identifier=TX1234567890 
#
# Enviar evento payment_timeout:
# python send_order_update.py payment_timeout --order-id=888
#
# Enviar evento payment_reproved com refund_identifier:
# python send_order_update.py payment_reproved --order-id=777 --refund-identifier=R123
#
# Troque --base-url se necessário para apontar para a URL correta do backend.

import argparse
import requests


def _base_order_info(args: argparse.Namespace, status: str) -> dict:
    return {
        "order_id": args.order_id,
        "status": status,
        "input_asset": args.input_asset,
        "input_amount": args.input_amount,
        "output_asset": args.output_asset,
        "output_amount_net": args.output_amount_net,
    }


def build_payload(args: argparse.Namespace) -> dict:
    if args.event == "payment_processing":
        order_info = _base_order_info(args, "processing")
        if args.network or args.wallet_address:
            order_info["payment_instructions"] = {
                "network": args.network,
                "wallet_address": args.wallet_address,
            }
        return {
            "template": "payment_processing",
            "client_id": args.client_id,
            "order_info": order_info,
        }

    if args.event == "order_concluded":
        order_info = _base_order_info(args, "concluded")
        payment_data_v2: dict = {}
        if args.payout_identifier:
            payment_data_v2["payout_identifier"] = args.payout_identifier
        if payment_data_v2:
            order_info["payment_data_v2"] = payment_data_v2
        if args.network or args.wallet_address:
            order_info["payment_instructions"] = {
                "network": args.network,
                "wallet_address": args.wallet_address,
            }
        return {
            "template": "order_concluded",
            "client_id": args.client_id,
            "order_info": order_info,
        }

    if args.event == "payment_timeout":
        return {
            "template": "payment_timeout",
            "client_id": args.client_id,
            "order_info": {
                "order_id": args.order_id,
                "status": "cancelled",
            },
        }

    if args.event == "payment_reproved":
        order_info = _base_order_info(args, "reproved")
        if args.refund_identifier:
            order_info["payment_data_v2"] = {
                "refund_identifier": args.refund_identifier,
            }
        return {
            "template": "payment_reproved",
            "client_id": args.client_id,
            "order_info": order_info,
        }

    raise ValueError(f"Evento inválido: {args.event}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Envia updates de pedido para o backend local da WebApp OTC."
    )

    parser.add_argument(
        "event",
        choices=["payment_processing", "order_concluded", "payment_timeout", "payment_reproved"],
        help="Tipo de atualização que será enviada.",
    )

    parser.add_argument(
        "--order-id",
        required=True,
        help="ID da ordem criada no create_order.",
    )

    parser.add_argument(
        "--client-id",
        default="",
        help="Client ID opcional da ordem.",
    )

    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="URL base do backend local.",
    )

    parser.add_argument(
        "--input-asset",
        default="BRL",
        help="Moeda/ativo que o cliente transfere (ex.: BRL, USDT).",
    )

    parser.add_argument(
        "--input-amount",
        type=float,
        default=1000.0,
        help="Quantidade no input_asset.",
    )

    parser.add_argument(
        "--output-asset",
        default="USDT",
        help="Moeda/ativo que será enviado ao cliente.",
    )

    parser.add_argument(
        "--output-amount-net",
        type=float,
        default=180.5,
        help="Quantidade líquida no output_asset.",
    )

    parser.add_argument(
        "--network",
        default="",
        help="Rede da wallet, ex: BSC.",
    )

    parser.add_argument(
        "--wallet-address",
        default="",
        help="Endereço da wallet do usuário.",
    )

    parser.add_argument(
        "--payout-identifier",
        default="",
        help="Tx hash ou comprovante do payout. Usado no order_concluded.",
    )

    parser.add_argument(
        "--refund-identifier",
        default="",
        help="Tx hash ou comprovante do reembolso. Usado no payment_reproved.",
    )

    args = parser.parse_args()

    payload = build_payload(args)

    response = requests.post(
        f"{args.base_url.rstrip('/')}/api/order-updates",
        json=payload,
        timeout=30,
    )

    print(f"status_code={response.status_code}")
    try:
        print(response.json())
    except Exception:
        print(response.text)

    response.raise_for_status()


if __name__ == "__main__":
    main()
