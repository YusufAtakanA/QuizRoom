# QuizRoom

QuizRoom is a web application that allows hosts to create quizzes manually or generate draft MCQs from supplied study notes using a pretrained language model. Generated questions undergo automatic validation and host review before approval. Players join a room using a code and participate in host-managed rounds with real-time question updates, answer submission, and scoreboards. The backend consists of five microservices: Accounts, Question Library, Live Game Sessions, Scoring, and AI Quiz Authoring. The project focuses on clear service responsibilities, reliable communication, persistent data ownership, and practical integration and evaluation of AI-generated content.

## Functional requirements

**F01** Hosts must be able to register and log in. An authenticated host must be able to manage their own quizzes and game sessions. Players must be able to participate as guests without creating an account.

**F02** Hosts must be able to create, edit, and delete quizzes. A playable quiz must contain between 1 and 10 MCQs. Each question must contain a question text, four distinct options, and one option marked as correct.

**F03** Hosts must be able to paste study notes and request a specified number of draft questions within the quiz size limit. Generated suggestions must include a question, four answer options, a proposed correct answer, a short explanation, and a supporting session from the supplied source.

**F04** Generated suggestions must be approved before they are presented to the host's review. Hosts must be able to edit, approve, or discard suggested questions. Only approved questions can be used in a game. Editing an approved question must return the question to the suggested ("Draft") state.

**F05** Hosts must be able to save quizzes and access them later. The library must distinguish between draft questions and approved questions and indicate whether a quiz is ready to use in a game.

**F06** Hosts must be able to select a playable quiz and create a game room with a unique active room code. Guest players must be able to join the lobby using this code and a nickname. The host and players must see the participant list update when players connect or disconnect.

**F07** The host must control when the game starts, when a question opens for answers, when answering closes, and when the next question begins. Only one question may be active at a time. There is no countdown timer.

**F08** Players must be able to submit one answer to each open question and receive confirmation that their answer was accepted. Accepted answers cannot be changed. The system must reject submissions for closed questions and prevent duplicate submissions. The host must see the number of submitted answers update during the round.

**F09** After a question closes, the system must award one point for a correct answer and zero points for an incorrect or missing answer (there is no speed bonus). Players must then see the correct answer, the explanation when available, and the updated leaderboard. Players with equal scores must share the same rank.

**F10** At the end of a game the system must display the final scoreboard and each participant's total score. The host must be able to access the completed session's outcomes after the game has ended.

**F11** There must be understandable error feedback messages for possible errors such as invalid room codes, unavailable rooms, or invalid quiz data.

## Technical requirements

**T01 — Microservice architecture.** The backend must consist of five independently runnable services. Each service must have a defined responsibility and communicate with other services through explicit interfaces.

| Service | Responsibility | Proposed technology |
|---|---|---|
| Accounts | Host registration, authentication, and account data. | Java / Spring Boot |
| Question Library | Quiz and question management, draft and approval status, and storage of notes and supporting explanations. | Java / Spring Boot |
| Live Game Sessions | Room codes, participants, session state, question progression, accepted answers, and live updates. | TypeScript / Node.js / Socket.IO |
| Scoring | Answer evaluation, per-question points, accumulated scores, rankings, and stored scoring results. | Java / Spring Boot |
| AI Quiz Authoring | Pretrained language-model integration, generation requests, structured output, and automatic draft validation. | Python / FastAPI |

These technologies are the proposed implementation stack, rather than additional course requirements.

**T02 — Service communication.** Request-response communication between services must use documented HTTP APIs with JSON payloads. Browser clients must receive live game events through Socket.IO, including participant changes, question opening and closing, answer counts, and leaderboard updates. Service calls must have timeouts and defined error responses. A failed request must not be treated as a successful operation.

**T03 — Data ownership and persistence.** Each service must control access to the data it owns. Services must not directly read or modify another service's database tables. Host accounts, saved quizzes, and completed game results must persist across application restarts. A single database server may be used with separate databases or schemas for the relevant services. The AI Quiz Authoring service may remain stateless.

**T04 — Authentication and access control.** Protected host operations must require a validated authentication token. Hosts must only be allowed to modify their own quizzes and control their own rooms. Guest players must receive a session identifier that links their submissions to the correct participant. Passwords must be stored as secure hashes, and model-provider credentials must remain on the backend. Correct-answer information must not be sent to player clients before the answer reveal.

**T05 — Authoritative game state and consistent scoring.** The Live Game Sessions service must determine whether a player is allowed to submit an answer and whether the relevant question is open. Client-provided scores must never be trusted. Each room must use a fixed snapshot of its selected quiz so that later library edits do not change an ongoing game. Repeated answer submissions or scoring requests must not create duplicate answers or award points more than once.

**T06 — AI generation and automatic validation.** The AI Quiz Authoring service must integrate an existing pretrained language model; training a model from scratch is outside the project scope. Model output must follow a defined JSON structure. Validation must check required fields, question count, non-empty text, four distinct answer options, and a valid correct-answer reference. Supporting excerpts must be checked against the supplied notes. Invalid output must not become approved quiz content. Passing these checks must not be treated as proof that the proposed answer is factually correct; host review remains required.

**T07 — AI evaluation.** The project must evaluate generated drafts using a fixed collection of sample study notes. The evaluation must report structural validity, human-reviewed correctness and support from the notes, the proportion of questions requiring edits or rejection, and generation time. The model identifier and prompt configuration used during evaluation must be recorded so that the results can be interpreted and compared.

**T08 — Testing.** Automated tests must cover quiz validation, approval rules, scoring, ranking ties, duplicate submissions, and invalid game-state transitions. Integration testing must cover the complete flow from quiz creation to final results, including unavailable AI generation and repeated scoring requests. Multiplayer testing must include one host and ten simultaneous guest players.

**T09 — Local execution and documentation.** The application must provide a documented local setup for the frontend, five backend services, and required databases. Configuration and secrets must be supplied through environment variables, with an example configuration file that contains no real credentials. The repository must include an architecture overview, service responsibilities, API and live-event descriptions, setup instructions, and instructions for running the tests.
