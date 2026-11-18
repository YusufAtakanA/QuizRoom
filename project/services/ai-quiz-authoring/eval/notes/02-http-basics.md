# HTTP basics

HTTP, the Hypertext Transfer Protocol, is the request-response protocol used by web browsers and by most services that talk to each other over a network. A client sends a request to a server, and the server sends back exactly one response. HTTP itself is stateless: the server does not remember earlier requests unless the application adds something such as a cookie or a token to link them.

Every request has a method, a path, headers and an optional body. The method says what the client wants to do. GET asks for a resource and should not change anything on the server. POST sends data to create something new or to trigger an action. PUT replaces a resource with the version in the request body, and DELETE removes a resource. A method is called idempotent when sending the same request several times has the same effect as sending it once; GET, PUT and DELETE are idempotent, while POST is not.

Headers carry extra information about the request or response. The Content-Type header tells the receiver how the body is encoded, for example application/json for JSON data. The Authorization header is often used to send a bearer token, written as the word Bearer followed by the token. The Accept header lets the client say which formats it can read.

Every response starts with a three-digit status code. The first digit gives the class of the response. Codes in the 200s mean success: 200 OK is the general success code, and 201 Created means a new resource was made, usually after a POST. A 204 No Content response means the request succeeded but there is no body to return, which is common after a DELETE.

Codes in the 400s mean the client made a mistake. 400 Bad Request means the request was malformed or failed validation. 401 Unauthorized actually means the client is not authenticated, for example because the token is missing or expired. 403 Forbidden means the client is known but is not allowed to do this. 404 Not Found means there is no resource at that path. 409 Conflict means the request clashes with the current state, such as registering an email address that is already taken.

Codes in the 500s mean the server failed. 500 Internal Server Error is a generic failure. 502 Bad Gateway means a server acting as a gateway received an invalid response from the server behind it. 503 Service Unavailable means the server is temporarily unable to handle the request, for example because a dependency is down. 504 Gateway Timeout means the gateway did not get a response in time from the server behind it.

Because any network call can be slow or fail, a client should always set a timeout instead of waiting forever. Retrying is safe for idempotent requests, but retrying a POST can create duplicates unless the server recognises the repeated request. A failed call must never be reported to the user as a success.

HTTPS is HTTP sent over an encrypted TLS connection. It protects the content of requests, including passwords and tokens, from being read or changed by anyone between the client and the server.
