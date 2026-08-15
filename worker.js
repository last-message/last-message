/**
 * =========================================================
 * LAST HUMAN MESSAGE
 * Cloudflare Worker
 * Version 3.1.0
 *
 * GitHub Pages:
 * https://last-message.github.io/last-message/
 *
 * IMPORTANT:
 * ALLOWED_ORIGIN must be:
 * https://last-message.github.io
 *
 * Bindings:
 * PAYMENTS -> KV Namespace
 * SEQUENCE -> Durable Object
 *
 * Rate Limiting:
 * RATE_CREATE -> Rate Limiting binding
 * RATE_VERIFY -> Rate Limiting binding
 * RATE_SUBMIT -> Rate Limiting binding
 * RATE_READ -> Rate Limiting binding
 *
 * Secrets:
 * TRONGRID_API_KEY
 * ADMIN_TOKEN
 *
 * Variables:
 * ALLOWED_ORIGIN
 * =========================================================
 */

const VERSION = "3.1.0";

const DEFAULT_ALLOWED_ORIGIN =
    "https://last-message.github.io";


/* =========================================================
   CONFIG
========================================================= */

const CONFIG = {

    PAYMENT_ADDRESS:
        "TDq9HhTWvAB1Pft7pum4Ty5k9Kyb2adHdx",

    USDT_CONTRACT:
        "TR7NHqKQqKTCi8q8ZY4pL8otSzgjLj6t",

    TRONGRID_API:
        "https://api.trongrid.io",

    PAYMENT_AMOUNT:
        2,

    USDT_DECIMALS:
        6,

    MESSAGE_MAX_LENGTH:
        4000,

    NAME_MAX_LENGTH:
        100,

    EMAIL_MAX_LENGTH:
        254,

    COUNTRY_MAX_LENGTH:
        100,

    CITY_MAX_LENGTH:
        100,

    ORDER_RETENTION_SECONDS:
        24 * 60 * 60,

    MESSAGE_RETENTION_SECONDS:
        5 * 365 * 24 * 60 * 60,

    TX_RETENTION_SECONDS:
        5 * 365 * 24 * 60 * 60,

    INITIAL_MESSAGE_NUMBER:
        10132,

    SEQUENCE_NAME:
        "global",

    PAYMENT_FUTURE_SKEW_SECONDS:
        5 * 60,

    CLAIM_LEASE_SECONDS:
        5 * 60,

    MAX_TRONGRID_PAGES:
        5

};


/* =========================================================
   DURABLE OBJECT
========================================================= */

export class SequenceCounter {

    constructor(state) {

        this.state = state;

    }


    async fetch(request) {

        const url =
            new URL(request.url);


        if (
            request.method !== "POST"
        ) {

            return json(
                {
                    success: false,
                    error: "Method not allowed",
                    version: VERSION
                },
                405
            );

        }


        if (
            url.pathname === "/next"
        ) {

            return this.nextNumber();

        }


        if (
            url.pathname === "/claim"
        ) {

            return this.claim(request);

        }


        if (
            url.pathname === "/release"
        ) {

            return this.release(request);

        }


        if (
            url.pathname === "/commit"
        ) {

            return this.commit(request);

        }


        if (
            url.pathname === "/message-lock"
        ) {

            return this.messageLock(request);

        }


        if (
            url.pathname === "/message-unlock"
        ) {

            return this.messageUnlock(request);

        }


        return json(
            {
                success: false,
                error: "Not found",
                version: VERSION
            },
            404
        );

    }


    /* =====================================================
       NEXT NUMBER
    ===================================================== */

    async nextNumber() {

        let current =
            await this.state.storage.get("value");


        let value =
            Number.isSafeInteger(current)
                ? current
                : CONFIG.INITIAL_MESSAGE_NUMBER;


        value += 1;


        if (
            !Number.isSafeInteger(value)
        ) {

            return json(
                {
                    success: false,
                    error: "Sequence exhausted",
                    version: VERSION
                },
                500
            );

        }


        await this.state.storage.put(
            "value",
            value
        );


        return json({

            success: true,

            number: value,

            version: VERSION

        });

    }


    /* =====================================================
       CLAIM
    ===================================================== */

    async claim(request) {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return json(
                {
                    success: false,
                    error: "Invalid JSON",
                    version: VERSION
                },
                400
            );

        }


        const key =
            typeof body?.key === "string"
                ? body.key.trim()
                : "";


        const token =
            typeof body?.token === "string"
                ? body.token.trim()
                : "";


        if (
            !key ||
            !token
        ) {

            return json(
                {
                    success: false,
                    error: "Invalid claim",
                    version: VERSION
                },
                400
            );

        }


        if (
            key.length > 300 ||
            token.length > 200
        ) {

            return json(
                {
                    success: false,
                    error: "Claim too large",
                    version: VERSION
                },
                400
            );

        }


        const storageKey =
            `claim:${key}`;


        const now =
            Date.now();


        /*
         * Permanent transaction replay marker.
         */
        if (
            key.startsWith("tx:")
        ) {

            const used =
                await this.state.storage.get(
                    `used:${key}`
                );


            if (used) {

                return json(
                    {
                        success: false,
                        claimed: false,
                        used: true,
                        error: "Transaction already used",
                        version: VERSION
                    },
                    409
                );

            }

        }


        const existing =
            await this.state.storage.get(
                storageKey
            );


        if (
            existing &&
            existing.expiresAt > now
        ) {

            return json(
                {
                    success: false,
                    claimed: false,
                    error: "Resource is busy",
                    version: VERSION
                },
                409
            );

        }


        const record = {

            token,

            createdAt:
                now,

            expiresAt:
                now +
                CONFIG.CLAIM_LEASE_SECONDS * 1000

        };


        await this.state.storage.put(
            storageKey,
            record
        );


        return json({

            success: true,

            claimed: true,

            /*
             * FIX:
             * Return token so caller can correctly
             * release or commit the claim.
             */
            token,

            version: VERSION

        });

    }


    /* =====================================================
       RELEASE
    ===================================================== */

    async release(request) {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return json(
                {
                    success: false,
                    error: "Invalid JSON",
                    version: VERSION
                },
                400
            );

        }


        const key =
            typeof body?.key === "string"
                ? body.key.trim()
                : "";


        const token =
            typeof body?.token === "string"
                ? body.token.trim()
                : "";


        if (
            !key ||
            !token
        ) {

            return json(
                {
                    success: false,
                    error: "Invalid release",
                    version: VERSION
                },
                400
            );

        }


        const storageKey =
            `claim:${key}`;


        const existing =
            await this.state.storage.get(
                storageKey
            );


        if (
            existing &&
            existing.token === token
        ) {

            await this.state.storage.delete(
                storageKey
            );

        }


        return json({

            success: true,

            version: VERSION

        });

    }


    /* =====================================================
       COMMIT
    ===================================================== */

    async commit(request) {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return json(
                {
                    success: false,
                    error: "Invalid JSON",
                    version: VERSION
                },
                400
            );

        }


        const key =
            typeof body?.key === "string"
                ? body.key.trim()
                : "";


        const token =
            typeof body?.token === "string"
                ? body.token.trim()
                : "";


        if (
            !key ||
            !token
        ) {

            return json(
                {
                    success: false,
                    error: "Invalid commit",
                    version: VERSION
                },
                400
            );

        }


        const storageKey =
            `claim:${key}`;


        const existing =
            await this.state.storage.get(
                storageKey
            );


        if (
            !existing ||
            existing.token !== token
        ) {

            return json(
                {
                    success: false,
                    error: "Claim expired or invalid",
                    version: VERSION
                },
                409
            );

        }


        await this.state.storage.delete(
            storageKey
        );


        /*
         * Transaction claims receive a permanent
         * replay marker.
         */
        if (
            key.startsWith("tx:")
        ) {

            await this.state.storage.put(

                `used:${key}`,

                {
                    committedAt:
                        Date.now()
                }

            );

        }


        return json({

            success: true,

            committed: true,

            version: VERSION

        });

    }


    /* =====================================================
       MESSAGE LOCK
    ===================================================== */

    async messageLock(request) {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return json(
                {
                    success: false,
                    error: "Invalid JSON",
                    version: VERSION
                },
                400
            );

        }


        const token =
            typeof body?.token === "string"
                ? body.token.trim()
                : "";


        if (!token) {

            return json(
                {
                    success: false,
                    error: "Missing token",
                    version: VERSION
                },
                400
            );

        }


        const key =
            "message-global-lock";


        const now =
            Date.now();


        const existing =
            await this.state.storage.get(
                key
            );


        if (
            existing &&
            existing.expiresAt > now
        ) {

            return json(
                {
                    success: false,
                    locked: true,
                    error: "Message system busy",
                    version: VERSION
                },
                409
            );

        }


        const lock = {

            token,

            expiresAt:
                now +
                CONFIG.CLAIM_LEASE_SECONDS * 1000

        };


        await this.state.storage.put(
            key,
            lock
        );


        return json({

            success: true,

            locked: true,

            token,

            version: VERSION

        });

    }


    /* =====================================================
       MESSAGE UNLOCK
    ===================================================== */

    async messageUnlock(request) {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return json(
                {
                    success: false,
                    error: "Invalid JSON",
                    version: VERSION
                },
                400
            );

        }


        const token =
            typeof body?.token === "string"
                ? body.token.trim()
                : "";


        if (!token) {

            return json(
                {
                    success: false,
                    error: "Missing token",
                    version: VERSION
                },
                400
            );

        }


        const existing =
            await this.state.storage.get(
                "message-global-lock"
            );


        if (
            existing &&
            existing.token === token
        ) {

            await this.state.storage.delete(
                "message-global-lock"
            );

        }


        return json({

            success: true,

            version: VERSION

        });

    }


    /* =====================================================
       ALARM
    ===================================================== */

    async alarm() {

        const now =
            Date.now();


        const entries =
            await this.state.storage.list({
                prefix: "claim:"
            });


        for (
            const [key, value]
            of entries
        ) {

            if (
                value?.expiresAt &&
                value.expiresAt <= now
            ) {

                await this.state.storage.delete(
                    key
                );

            }

        }


        const lock =
            await this.state.storage.get(
                "message-global-lock"
            );


        if (
            lock?.expiresAt &&
            lock.expiresAt <= now
        ) {

            await this.state.storage.delete(
                "message-global-lock"
            );

        }

    }

}


/* =========================================================
   MAIN WORKER
========================================================= */

export default {

    async fetch(request, env) {

        const url =
            new URL(request.url);


        /*
         * CORS / Origin
         *
         * GitHub Pages origin:
         *
         * https://last-message.github.io
         *
         * NOT:
         * https://last-message.github.io/last-message/
         */

        const corsResult =
            validateOrigin(
                request,
                env
            );


        if (
            !corsResult.allowed
        ) {

            return error(
                "Origin not allowed",
                403,
                env
            );

        }


        /*
         * PREFLIGHT
         */

        if (
            request.method === "OPTIONS"
        ) {

            return new Response(
                null,
                {
                    status: 204,
                    headers:
                        getCorsHeaders(env)
                }
            );

        }


        /*
         * RATE LIMIT
         */

        const rateLimitResult =
            await applyRateLimit(
                request,
                env,
                url.pathname
            );


        if (
            !rateLimitResult.allowed
        ) {

            return error(
                "Too many requests",
                429,
                env
            );

        }


        /*
         * HEALTH
         */

        if (
            request.method === "GET" &&
            url.pathname === "/"
        ) {

            return json({

                success: true,

                service:
                    "Last Human Message",

                version:
                    VERSION,

                status:
                    "online",

                allowedOrigin:
                    getAllowedOrigin(env)

            }, 200, env);

        }


        /*
         * CREATE ORDER
         */

        if (
            request.method === "GET" &&
            url.pathname === "/create-order"
        ) {

            return createOrder(
                request,
                env
            );

        }


        /*
         * VERIFY PAYMENT
         */

        if (
            (
                request.method === "GET" ||
                request.method === "POST"
            ) &&
            url.pathname === "/verify-payment"
        ) {

            return verifyPayment(
                request,
                env
            );

        }


        /*
         * CHECK ORDER
         */

        if (
            request.method === "GET" &&
            url.pathname === "/check-order"
        ) {

            return checkOrder(
                request,
                env
            );

        }


        /*
         * SUBMIT MESSAGE
         */

        if (
            request.method === "POST" &&
            url.pathname === "/submit-message"
        ) {

            return submitMessage(
                request,
                env
            );

        }


        /*
         * GET MESSAGE
         */

        if (
            request.method === "GET" &&
            url.pathname === "/get-message"
        ) {

            return getMessage(
                request,
                env
            );

        }


        /*
         * PREVIOUS MESSAGE
         */

        if (
            request.method === "GET" &&
            url.pathname === "/previous-message"
        ) {

            return getPreviousMessage(
                request,
                env
            );

        }


        /*
         * ADMIN STATS
         */

        if (
            request.method === "GET" &&
            url.pathname === "/admin/stats"
        ) {

            if (
                !isAdmin(request, env)
            ) {

                return error(
                    "Unauthorized",
                    401,
                    env
                );

            }


            return adminStats(env);

        }


        /*
         * ADMIN MESSAGE
         */

        if (
            request.method === "GET" &&
            url.pathname === "/admin/get-message"
        ) {

            if (
                !isAdmin(request, env)
            ) {

                return error(
                    "Unauthorized",
                    401,
                    env
                );

            }


            return adminGetMessage(
                request,
                env
            );

        }


        return error(
            "Endpoint not found",
            404,
            env
        );

    }

};


/* =========================================================
   CREATE ORDER
========================================================= */

async function createOrder(
    request,
    env
) {

    const orderId =
        crypto.randomUUID();


    const createdAt =
        Date.now();


    const order = {

        version:
            VERSION,

        orderId,

        status:
            "pending",

        amount:
            CONFIG.PAYMENT_AMOUNT,

        currency:
            "USDT",

        network:
            "TRC20",

        address:
            CONFIG.PAYMENT_ADDRESS,

        createdAt,

        createdAtISO:
            new Date(createdAt).toISOString()

    };


    await env.PAYMENTS.put(

        `order:${orderId}`,

        JSON.stringify(order),

        {
            expirationTtl:
                CONFIG.ORDER_RETENTION_SECONDS
        }

    );


    return json(
        order,
        200,
        env
    );

}


/* =========================================================
   VERIFY PAYMENT
========================================================= */

async function verifyPayment(
    request,
    env
) {

    let orderId = "";
    let txid = "";


    if (
        request.method === "GET"
    ) {

        const url =
            new URL(request.url);


        orderId =
            string(
                url.searchParams.get("orderId")
            );


        txid =
            string(
                url.searchParams.get("txid")
            );

    } else {

        let body;


        try {

            body =
                await request.json();

        } catch {

            return error(
                "Invalid JSON",
                400,
                env
            );

        }


        orderId =
            string(body?.orderId);


        txid =
            string(body?.txid);

    }


    if (
        !isValidUUID(orderId)
    ) {

        return error(
            "Invalid orderId",
            400,
            env
        );

    }


    if (
        !/^[a-fA-F0-9]{64}$/.test(txid)
    ) {

        return error(
            "Invalid transaction ID",
            400,
            env
        );

    }


    const orderRaw =
        await env.PAYMENTS.get(
            `order:${orderId}`
        );


    if (!orderRaw) {

        return error(
            "Order not found",
            404,
            env
        );

    }


    let order;


    try {

        order =
            JSON.parse(orderRaw);

    } catch {

        return error(
            "Invalid order data",
            500,
            env
        );

    }


    if (
        order.status === "paid"
    ) {

        return json({

            success: true,

            paid: true,

            orderId,

            status: "paid"

        }, 200, env);

    }


    /*
     * ORDER CLAIM
     */

    const orderClaimToken =
        crypto.randomUUID();


    const orderClaim =
        await sequenceRequest(
            env,
            "/claim",
            {
                key:
                    `order:${orderId}`,

                token:
                    orderClaimToken
            }
        );


    if (
        !orderClaim.ok
    ) {

        return json({

            success: true,

            paid: false,

            orderId,

            status: "checking"

        }, 202, env);

    }


    let txClaimToken = null;
    let txCommitted = false;


    try {

        /*
         * TX CLAIM
         */

        txClaimToken =
            crypto.randomUUID();


        const txClaim =
            await sequenceRequest(
                env,
                "/claim",
                {
                    key:
                        `tx:${txid}`,

                    token:
                        txClaimToken
                }
            );


        if (
            !txClaim.ok
        ) {

            return json(
                {
                    success: false,
                    paid: false,
                    error: "Transaction already used"
                },
                409,
                env
            );

        }


        /*
         * SEARCH BLOCKCHAIN
         */

        const found =
            await findTransaction(
                txid,
                order.createdAt,
                env
            );


        if (!found) {

            await sequenceRequest(
                env,
                "/release",
                {
                    key:
                        `tx:${txid}`,

                    token:
                        txClaimToken
                }
            );


            txClaimToken = null;


            return json({

                success: true,

                paid: false,

                orderId,

                status: "pending"

            }, 200, env);

        }


        /*
         * PAYMENT CONFIRMED
         */

        order.status =
            "paid";


        order.txid =
            found.txid;


        order.paidAmount =
            found.amount;


        order.sender =
            found.sender;


        order.receiver =
            found.receiver;


        order.paidAt =
            Date.now();


        order.paidAtISO =
            new Date(
                order.paidAt
            ).toISOString();


        await env.PAYMENTS.put(

            `order:${orderId}`,

            JSON.stringify(order),

            {
                expirationTtl:
                    CONFIG.ORDER_RETENTION_SECONDS
            }

        );


        /*
         * Permanent transaction record.
         */

        await env.PAYMENTS.put(

            `tx:${txid}`,

            JSON.stringify({

                version:
                    VERSION,

                txid,

                orderId,

                usedAt:
                    Date.now()

            }),

            {
                expirationTtl:
                    CONFIG.TX_RETENTION_SECONDS
            }

        );


        /*
         * COMMIT TX CLAIM
         */

        const txCommit =
            await sequenceRequest(
                env,
                "/commit",
                {
                    key:
                        `tx:${txid}`,

                    token:
                        txClaimToken
                }
            );


        if (
            !txCommit.ok
        ) {

            throw new Error(
                "Unable to commit transaction claim"
            );

        }


        txCommitted = true;
        txClaimToken = null;


        /*
         * RELEASE ORDER CLAIM
         */

        await sequenceRequest(
            env,
            "/release",
            {
                key:
                    `order:${orderId}`,

                token:
                    orderClaimToken
            }
        );


        return json({

            success: true,

            paid: true,

            orderId,

            status: "paid"

        }, 200, env);

    }


    catch (err) {

        console.error(
            "Payment verification failed",
            err
        );


        return error(
            "Payment verification failed",
            502,
            env
        );

    }


    finally {

        /*
         * Release transaction claim if it
         * wasn't committed.
         */

        if (
            txClaimToken &&
            !txCommitted
        ) {

            try {

                await sequenceRequest(
                    env,
                    "/release",
                    {
                        key:
                            `tx:${txid}`,

                        token:
                            txClaimToken
                    }
                );

            } catch {}

        }


        /*
         * Always release order claim.
         */

        try {

            await sequenceRequest(
                env,
                "/release",
                {
                    key:
                        `order:${orderId}`,

                    token:
                        orderClaimToken
                }
            );

        } catch {}

    }

}


/* =========================================================
   FIND TRON TRANSACTION
========================================================= */

async function findTransaction(
    txid,
    createdAt,
    env
) {

    const orderCreatedAt =
        Number(createdAt);


    if (
        !Number.isFinite(orderCreatedAt)
    ) {

        throw new Error(
            "Invalid order timestamp"
        );

    }


    const now =
        Date.now();


    const minTimestamp =
        orderCreatedAt;


    const maxTimestamp =
        now +
        CONFIG.PAYMENT_FUTURE_SKEW_SECONDS *
        1000;


    let fingerprint = null;


    for (
        let page = 0;
        page < CONFIG.MAX_TRONGRID_PAGES;
        page++
    ) {

        const params =
            new URLSearchParams();


        params.set(
            "limit",
            "200"
        );


        params.set(
            "only_confirmed",
            "true"
        );


        params.set(
            "only_to",
            "true"
        );


        params.set(
            "contract_address",
            CONFIG.USDT_CONTRACT
        );


        params.set(
            "min_timestamp",
            String(minTimestamp)
        );


        params.set(
            "max_timestamp",
            String(maxTimestamp)
        );


        params.set(
            "order_by",
            "block_timestamp,desc"
        );


        if (fingerprint) {

            params.set(
                "fingerprint",
                fingerprint
            );

        }


        const api =
            CONFIG.TRONGRID_API +
            "/v1/accounts/" +
            CONFIG.PAYMENT_ADDRESS +
            "/transactions/trc20?" +
            params.toString();


        let response;


        try {

            response =
                await fetch(
                    api,
                    {
                        method: "GET",

                        headers: {

                            "TRON-PRO-API-KEY":
                                env.TRONGRID_API_KEY,

                            "Accept":
                                "application/json"

                        }
                    }
                );

        } catch {

            throw new Error(
                "TRON API unavailable"
            );

        }


        if (
            !response.ok
        ) {

            const text =
                await response.text();


            console.error(
                "TronGrid response:",
                response.status,
                text
            );


            throw new Error(
                "TRON API request failed"
            );

        }


        const data =
            await response.json();


        const transactions =
            Array.isArray(data?.data)
                ? data.data
                : [];


        for (
            const tx of transactions
        ) {

            if (!tx) {
                continue;
            }


            if (
                tx.transaction_id !== txid
            ) {
                continue;
            }


            if (
                tx.token_info?.address !==
                CONFIG.USDT_CONTRACT
            ) {
                continue;
            }


            if (
                tx.token_info?.symbol &&
                String(
                    tx.token_info.symbol
                ).toUpperCase() !== "USDT"
            ) {
                continue;
            }


            if (
                tx.to !==
                CONFIG.PAYMENT_ADDRESS
            ) {
                continue;
            }


            const rawValue =
                Number(tx.value);


            if (
                !Number.isFinite(rawValue) ||
                rawValue <= 0
            ) {
                continue;
            }


            const amount =
                rawValue /
                (
                    10 **
                    CONFIG.USDT_DECIMALS
                );


            if (
                amount <
                CONFIG.PAYMENT_AMOUNT
            ) {
                continue;
            }


            const timestamp =
                Number(
                    tx.block_timestamp
                );


            if (
                !Number.isFinite(timestamp)
            ) {
                continue;
            }


            if (
                timestamp <
                orderCreatedAt
            ) {
                continue;
            }


            if (
                timestamp >
                maxTimestamp
            ) {
                continue;
            }


            if (
                tx.confirmed === false
            ) {
                continue;
            }


            return {

                txid:
                    tx.transaction_id,

                amount,

                timestamp,

                sender:
                    tx.from,

                receiver:
                    tx.to

            };

        }


        fingerprint =
            data?.meta?.fingerprint ||
            null;


        if (!fingerprint) {
            break;
        }

    }


    return null;

}


/* =========================================================
   CHECK ORDER
========================================================= */

async function checkOrder(
    request,
    env
) {

    const url =
        new URL(request.url);


    const orderId =
        string(
            url.searchParams.get("orderId")
        );


    if (
        !isValidUUID(orderId)
    ) {

        return error(
            "Invalid orderId",
            400,
            env
        );

    }


    const raw =
        await env.PAYMENTS.get(
            `order:${orderId}`
        );


    if (!raw) {

        return error(
            "Order not found",
            404,
            env
        );

    }


    let order;


    try {

        order =
            JSON.parse(raw);

    } catch {

        return error(
            "Invalid order data",
            500,
            env
        );

    }


    return json({

        success: true,

        version:
            VERSION,

        orderId,

        status:
            order.status,

        paid:
            order.status === "paid",

        messageId:
            order.messageId || null,

        messageNumber:
            order.messageNumber || null

    }, 200, env);

}


/* =========================================================
   SUBMIT MESSAGE
========================================================= */

async function submitMessage(
    request,
    env
) {

    const contentLength =
        Number(
            request.headers.get(
                "content-length"
            ) || 0
        );


    if (
        contentLength > 16 * 1024
    ) {

        return error(
            "Request body too large",
            413,
            env
        );

    }


    let body;


    try {

        body =
            await request.json();

    } catch {

        return error(
            "Invalid JSON",
            400,
            env
        );

    }


    const orderId =
        string(body?.orderId);


    const name =
        normalizeText(body?.name);


    const email =
        normalizeEmail(body?.email);


    const country =
        normalizeText(body?.country);


    const city =
        normalizeText(body?.city);


    const message =
        normalizeMessage(body?.message);


    if (
        !isValidUUID(orderId)
    ) {

        return error(
            "Invalid order ID",
            400,
            env
        );

    }


    if (!name) {

        return error(
            "Name is required",
            400,
            env
        );

    }


    if (!email) {

        return error(
            "Email is required",
            400,
            env
        );

    }


    if (!country) {

        return error(
            "Country is required",
            400,
            env
        );

    }


    if (!city) {

        return error(
            "City is required",
            400,
            env
        );

    }


    if (!message) {

        return error(
            "Message is required",
            400,
            env
        );

    }


    if (
        name.length >
        CONFIG.NAME_MAX_LENGTH
    ) {

        return error(
            "Name too long",
            400,
            env
        );

    }


    if (
        email.length >
        CONFIG.EMAIL_MAX_LENGTH
    ) {

        return error(
            "Email too long",
            400,
            env
        );

    }


    if (
        country.length >
        CONFIG.COUNTRY_MAX_LENGTH
    ) {

        return error(
            "Country too long",
            400,
            env
        );

    }


    if (
        city.length >
        CONFIG.CITY_MAX_LENGTH
    ) {

        return error(
            "City too long",
            400,
            env
        );

    }


    if (
        message.length >
        CONFIG.MESSAGE_MAX_LENGTH
    ) {

        return error(
            "Message too long",
            400,
            env
        );

    }


    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {

        return error(
            "Invalid email",
            400,
            env
        );

    }


    const orderRaw =
        await env.PAYMENTS.get(
            `order:${orderId}`
        );


    if (!orderRaw) {

        return error(
            "Order not found",
            404,
            env
        );

    }


    let order;


    try {

        order =
            JSON.parse(orderRaw);

    } catch {

        return error(
            "Invalid order data",
            500,
            env
        );

    }


    if (
        order.status !== "paid"
    ) {

        return error(
            "Payment has not been confirmed",
            403,
            env
        );

    }


    /*
     * One message per order.
     */

    const claimToken =
        crypto.randomUUID();


    const claim =
        await sequenceRequest(
            env,
            "/claim",
            {
                key:
                    `message-order:${orderId}`,

                token:
                    claimToken
            }
        );


    if (
        !claim.ok
    ) {

        return error(
            "Message is already being submitted",
            409,
            env
        );

    }


    let globalLockToken = null;


    try {

        const existing =
            await env.PAYMENTS.get(
                `message:${orderId}`
            );


        if (existing) {

            return error(
                "Message already submitted",
                409,
                env
            );

        }


        /*
         * GLOBAL MESSAGE LOCK
         */

        globalLockToken =
            crypto.randomUUID();


        const lock =
            await sequenceRequest(
                env,
                "/message-lock",
                {
                    token:
                        globalLockToken
                }
            );


        if (
            !lock.ok
        ) {

            return error(
                "Message system is busy",
                409,
                env
            );

        }


        /*
         * Recheck after acquiring global lock.
         */

        const latestRaw =
            await env.PAYMENTS.get(
                "latest-message"
            );


        let previous = null;


        if (latestRaw) {

            try {

                previous =
                    JSON.parse(latestRaw);

            } catch {

                previous = null;

            }

        }


        /*
         * Generate sequence.
         */

        const sequenceResponse =
            await sequenceRequest(
                env,
                "/next",
                {}
            );


        if (
            !sequenceResponse.ok
        ) {

            throw new Error(
                "Unable to generate message number"
            );

        }


        const sequenceData =
            await sequenceResponse.json();


        if (
            !sequenceData.success ||
            !Number.isSafeInteger(
                sequenceData.number
            )
        ) {

            throw new Error(
                "Invalid sequence response"
            );

        }


        const messageNumber =
            sequenceData.number;


        const messageId =
            crypto.randomUUID();


        const createdAt =
            Date.now();


        const previousMessageId =
            previous
                ? previous.messageId || null
                : null;


        const previousMessageNumber =
            previous
                ? previous.messageNumber || null
                : null;


        const record = {

            version:
                VERSION,

            messageNumber,

            messageId,

            orderId,

            name,

            country,

            city,

            message,

            previousMessageId,

            previousMessageNumber,

            createdAt,

            createdAtISO:
                new Date(
                    createdAt
                ).toISOString(),

            private: {

                email,

                payment: {

                    txid:
                        order.txid ||
                        null,

                    amount:
                        order.paidAmount ||
                        null,

                    currency:
                        order.currency ||
                        "USDT",

                    network:
                        order.network ||
                        "TRC20",

                    sender:
                        order.sender ||
                        null,

                    receiver:
                        order.receiver ||
                        null

                }

            }

        };


        const serialized =
            JSON.stringify(record);


        /*
         * SAVE BY ORDER
         */

        await env.PAYMENTS.put(

            `message:${orderId}`,

            serialized,

            {
                expirationTtl:
                    CONFIG.MESSAGE_RETENTION_SECONDS
            }

        );


        /*
         * SAVE BY ID
         */

        await env.PAYMENTS.put(

            `message-id:${messageId}`,

            serialized,

            {
                expirationTtl:
                    CONFIG.MESSAGE_RETENTION_SECONDS
            }

        );


        /*
         * SAVE BY NUMBER
         */

        await env.PAYMENTS.put(

            `message-number:${messageNumber}`,

            serialized,

            {
                expirationTtl:
                    CONFIG.MESSAGE_RETENTION_SECONDS
            }

        );


        /*
         * LATEST
         */

        await env.PAYMENTS.put(

            "latest-message",

            serialized,

            {
                expirationTtl:
                    CONFIG.MESSAGE_RETENTION_SECONDS
            }

        );


        /*
         * LINK ORDER
         */

        order.messageId =
            messageId;


        order.messageNumber =
            messageNumber;


        order.messageSubmittedAt =
            createdAt;


        await env.PAYMENTS.put(

            `order:${orderId}`,

            JSON.stringify(order),

            {
                expirationTtl:
                    CONFIG.ORDER_RETENTION_SECONDS
            }

        );


        return json({

            success: true,

            submitted: true,

            version:
                VERSION,

            messageId,

            messageNumber,

            orderId,

            previousMessageNumber

        }, 200, env);

    }


    catch (err) {

        console.error(
            "Message submission failed",
            err
        );


        return error(
            "Unable to submit message",
            500,
            env
        );

    }


    finally {

        /*
         * FIX:
         * Global lock is now actually released.
         */

        if (
            globalLockToken
        ) {

            try {

                await sequenceRequest(
                    env,
                    "/message-unlock",
                    {
                        token:
                            globalLockToken
                    }
                );

            } catch {}

        }


        try {

            await sequenceRequest(
                env,
                "/release",
                {
                    key:
                        `message-order:${orderId}`,

                    token:
                        claimToken
                }
            );

        } catch {}

    }

}


/* =========================================================
   GET MESSAGE
========================================================= */

async function getMessage(
    request,
    env
) {

    const url =
        new URL(request.url);


    const messageId =
        string(
            url.searchParams.get(
                "messageId"
            )
        );


    if (
        !isValidUUID(messageId)
    ) {

        return error(
            "Invalid message ID",
            400,
            env
        );

    }


    const raw =
        await env.PAYMENTS.get(
            `message-id:${messageId}`
        );


    if (!raw) {

        return error(
            "Message not found",
            404,
            env
        );

    }


    let message;


    try {

        message =
            JSON.parse(raw);

    } catch {

        return error(
            "Invalid message data",
            500,
            env
        );

    }


    return json({

        success: true,

        version:
            VERSION,

        message:
            publicMessage(message)

    }, 200, env);

}


/* =========================================================
   PREVIOUS MESSAGE
========================================================= */

async function getPreviousMessage(
    request,
    env
) {

    const url =
        new URL(request.url);


    const messageId =
        string(
            url.searchParams.get(
                "messageId"
            )
        );


    if (
        !isValidUUID(messageId)
    ) {

        return error(
            "Invalid message ID",
            400,
            env
        );

    }


    const currentRaw =
        await env.PAYMENTS.get(
            `message-id:${messageId}`
        );


    if (!currentRaw) {

        return error(
            "Message not found",
            404,
            env
        );

    }


    let current;


    try {

        current =
            JSON.parse(currentRaw);

    } catch {

        return error(
            "Invalid message data",
            500,
            env
        );

    }


    if (
        !current.previousMessageId
    ) {

        return json({

            success: true,

            hasPrevious: false,

            message: null

        }, 200, env);

    }


    const previousRaw =
        await env.PAYMENTS.get(
            `message-id:${current.previousMessageId}`
        );


    if (!previousRaw) {

        return json({

            success: true,

            hasPrevious: false,

            message: null

        }, 200, env);

    }


    let previous;


    try {

        previous =
            JSON.parse(previousRaw);

    } catch {

        return error(
            "Invalid previous message data",
            500,
            env
        );

    }


    return json({

        success: true,

        hasPrevious: true,

        message:
            publicMessage(previous)

    }, 200, env);

}


/* =========================================================
   ADMIN STATS
========================================================= */

async function adminStats(
    env
) {

    const latestRaw =
        await env.PAYMENTS.get(
            "latest-message"
        );


    let latest = null;


    if (latestRaw) {

        try {

            latest =
                JSON.parse(latestRaw);

        } catch {

            latest = null;

        }

    }


    return json({

        success: true,

        version:
            VERSION,

        latestMessageNumber:
            latest
                ? latest.messageNumber
                : null,

        latestMessageId:
            latest
                ? latest.messageId
                : null

    }, 200, env);

}


/* =========================================================
   ADMIN GET MESSAGE
========================================================= */

async function adminGetMessage(
    request,
    env
) {

    const url =
        new URL(request.url);


    const number =
        string(
            url.searchParams.get(
                "number"
            )
        );


    if (
        !/^\d{1,20}$/.test(number)
    ) {

        return error(
            "Invalid number",
            400,
            env
        );

    }


    const raw =
        await env.PAYMENTS.get(
            `message-number:${number}`
        );


    if (!raw) {

        return error(
            "Message not found",
            404,
            env
        );

    }


    let message;


    try {

        message =
            JSON.parse(raw);

    } catch {

        return error(
            "Invalid message data",
            500,
            env
        );

    }


    return json({

        success: true,

        version:
            VERSION,

        message

    }, 200, env);

}


/* =========================================================
   ADMIN AUTH
========================================================= */

function isAdmin(
    request,
    env
) {

    const configuredToken =
        typeof env.ADMIN_TOKEN === "string"
            ? env.ADMIN_TOKEN
            : "";


    if (!configuredToken) {

        return false;

    }


    const authorization =
        request.headers.get(
            "Authorization"
        ) || "";


    const prefix =
        "Bearer ";


    if (
        !authorization.startsWith(prefix)
    ) {

        return false;

    }


    const supplied =
        authorization
            .slice(prefix.length)
            .trim();


    if (!supplied) {

        return false;

    }


    return timingSafeEqualString(
        supplied,
        configuredToken
    );

}


/* =========================================================
   CONSTANT TIME COMPARE
========================================================= */

function timingSafeEqualString(
    a,
    b
) {

    const encoder =
        new TextEncoder();


    const aa =
        encoder.encode(a);


    const bb =
        encoder.encode(b);


    if (
        aa.length !== bb.length
    ) {

        return false;

    }


    let diff = 0;


    for (
        let i = 0;
        i < aa.length;
        i++
    ) {

        diff |=
            aa[i] ^ bb[i];

    }


    return diff === 0;

}


/* =========================================================
   PUBLIC MESSAGE
========================================================= */

function publicMessage(
    record
) {

    return {

        messageNumber:
            record.messageNumber ||
            null,

        messageId:
            record.messageId ||
            null,

        name:
            record.name ||
            "",

        country:
            record.country ||
            "",

        city:
            record.city ||
            "",

        message:
            record.message ||
            "",

        previousMessageId:
            record.previousMessageId ||
            null,

        previousMessageNumber:
            record.previousMessageNumber ||
            null,

        createdAt:
            record.createdAt ||
            null,

        createdAtISO:
            record.createdAtISO ||
            null

    };

}


/* =========================================================
   TEXT NORMALIZATION
========================================================= */

function normalizeText(
    value
) {

    if (
        typeof value !== "string"
    ) {

        return "";

    }


    return value
        .replace(/\u0000/g, "")
        .trim();

}


/* =========================================================
   MESSAGE NORMALIZATION
========================================================= */

function normalizeMessage(
    value
) {

    if (
        typeof value !== "string"
    ) {

        return "";

    }


    return value
        .replace(/\u0000/g, "")
        .trim();

}


/* =========================================================
   EMAIL
========================================================= */

function normalizeEmail(
    value
) {

    if (
        typeof value !== "string"
    ) {

        return "";

    }


    return value
        .trim()
        .toLowerCase();

}


/* =========================================================
   STRING
========================================================= */

function string(
    value
) {

    return typeof value === "string"
        ? value.trim()
        : "";

}


/* =========================================================
   UUID
========================================================= */

function isValidUUID(
    value
) {

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);

}


/* =========================================================
   ALLOWED ORIGIN
========================================================= */

function getAllowedOrigin(
    env
) {

    /*
     * If ALLOWED_ORIGIN exists in Cloudflare,
     * use it.
     *
     * Otherwise safely fall back to the
     * production GitHub Pages origin.
     */

    const configured =
        typeof env.ALLOWED_ORIGIN === "string"
            ? env.ALLOWED_ORIGIN.trim()
            : "";


    return configured ||
        DEFAULT_ALLOWED_ORIGIN;

}


/* =========================================================
   ORIGIN VALIDATION
========================================================= */

function validateOrigin(
    request,
    env
) {

    const allowedOrigin =
        getAllowedOrigin(env);


    /*
     * Remove accidental trailing slash.
     *
     * This means:
     *
     * https://last-message.github.io/
     *
     * becomes:
     *
     * https://last-message.github.io
     */

    const normalizedAllowed =
        allowedOrigin.replace(
            /\/+$/,
            ""
        );


    const origin =
        request.headers.get(
            "Origin"
        );


    /*
     * Browser request.
     */

    if (origin) {

        return {

            allowed:
                origin ===
                normalizedAllowed

        };

    }


    /*
     * Non-browser requests without Origin
     * are allowed here.
     *
     * Endpoint-specific validation,
     * authentication and rate limiting
     * still apply.
     */

    return {

        allowed: true

    };

}


/* =========================================================
   CORS HEADERS
========================================================= */

function getCorsHeaders(
    env
) {

    return {

        "Access-Control-Allow-Origin":
            getAllowedOrigin(env)
                .replace(/\/+$/, ""),

        "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type, Authorization",

        "Access-Control-Max-Age":
            "86400",

        "Vary":
            "Origin"

    };

}


/* =========================================================
   RATE LIMIT
========================================================= */

async function applyRateLimit(
    request,
    env,
    pathname
) {

    const ip =
        request.headers.get(
            "CF-Connecting-IP"
        ) ||
        "unknown";


    let limiter = null;

    let prefix = pathname;


    if (
        pathname === "/create-order"
    ) {

        limiter =
            env.RATE_CREATE;

        prefix =
            "create";

    }


    else if (
        pathname === "/verify-payment"
    ) {

        limiter =
            env.RATE_VERIFY;

        prefix =
            "verify";

    }


    else if (
        pathname === "/submit-message"
    ) {

        limiter =
            env.RATE_SUBMIT;

        prefix =
            "submit";

    }


    else if (
        pathname === "/check-order" ||
        pathname === "/get-message" ||
        pathname === "/previous-message"
    ) {

        limiter =
            env.RATE_READ;

        prefix =
            "read";

    }


    if (!limiter) {

        return {

            allowed: true

        };

    }


    try {

        const result =
            await limiter.limit({

                key:
                    `${prefix}:${ip}`

            });


        return {

            allowed:
                result.success

        };

    }


    catch (err) {

        console.error(
            "Rate limit error",
            err
        );


        return {

            allowed: false

        };

    }

}


/* =========================================================
   DURABLE OBJECT REQUEST
========================================================= */

async function sequenceRequest(
    env,
    pathname,
    body
) {

    if (
        !env.SEQUENCE
    ) {

        throw new Error(
            "SEQUENCE Durable Object binding missing"
        );

    }


    const id =
        env.SEQUENCE.idFromName(
            CONFIG.SEQUENCE_NAME
        );


    const stub =
        env.SEQUENCE.get(id);


    return stub.fetch(

        `https://sequence${pathname}`,

        {

            method:
                "POST",

            headers: {

                "Content-Type":
                    "application/json"

            },

            body:
                JSON.stringify(
                    body || {}
                )

        }

    );

}


/* =========================================================
   ERROR
========================================================= */

function error(
    message,
    status,
    env
) {

    return json(

        {

            success: false,

            error:
                message,

            version:
                VERSION

        },

        status,

        env

    );

}


/* =========================================================
   JSON
========================================================= */

function json(
    data,
    status = 200,
    env = null
) {

    const headers = {

        "Content-Type":
            "application/json; charset=UTF-8",

        "Cache-Control":
            "no-store",

        "X-Content-Type-Options":
            "nosniff",

        "Referrer-Policy":
            "no-referrer",

        "X-Frame-Options":
            "DENY",

        "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'"

    };


    if (env) {

        Object.assign(
            headers,
            getCorsHeaders(env)
        );

    }


    return new Response(

        JSON.stringify(
            data,
            null,
            2
        ),

        {

            status,

            headers

        }

    );

}
