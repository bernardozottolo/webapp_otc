import argparse
import requests


def build_payload(args: argparse.Namespace) -> dict:
    if args.event == "payment_recognized":
        return {
            "template": "payment_recognized",
            "client_id": args.client_id,
            "order_info": {
                "order_id": args.order_id,
                "status": "payment_confirmed",
                "payment_data": {
                    "tx_hash": None,
                    "network": args.network,
                    "wallet_address": args.wallet_address,
                },
            },
        }

    if args.event == "order_concluded":
        return {
            "template": "order_concluded",
            "client_id": args.client_id,
            "order_info": {
                "order_id": args.order_id,
                "status": "concluded",
                "payment_data": {
                    "tx_hash": args.tx_hash,
                    "tx_hash_url": args.tx_hash_url,
                    "network": args.network,
                    "wallet_address": args.wallet_address,
                },
            },
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

    raise ValueError(f"Evento inválido: {args.event}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Envia updates de pedido para o backend local da WebApp OTC."
    )

    parser.add_argument(
        "event",
        choices=["payment_recognized", "order_concluded", "payment_timeout"],
        help="Tipo de atualização que será enviada."
    )

    parser.add_argument(
        "--order-id",
        required=True,
        help="ID da ordem criada no create_order."
    )

    parser.add_argument(
        "--client-id",
        default="",
        help="Client ID opcional da ordem."
    )

    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="URL base do backend local."
    )

    parser.add_argument(
        "--network",
        default="",
        help="Rede da wallet, ex: BSC."
    )

    parser.add_argument(
        "--wallet-address",
        default="",
        help="Endereço da wallet do usuário."
    )

    parser.add_argument(
        "--tx-hash-url",
        default="",
        help="URL da transação. Usado no order_concluded."
    )

    parser.add_argument(
        "--tx-hash",
        default="",
        help="Hash da transação. Usado no order_concluded."
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
