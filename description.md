# QuizRoom
QuizRoom is a web application that allows hosts to create quizzes manually or generate draft MCQs from supplied study notes using a pretrained language model. Generated questions undergo automatic validation and host review before approval. Players join a room using a code and participate in host managed rounds with real time question updates, answer submission, and scoreboards. The backend consists of five microservices: Accounts, Question Library, Live Game Sessions, Scoring, and AI Quiz Authoring. The project focuses on clear service responsibilities, reliable communication, persistent data ownership, and practical integration and evaluation of AI generated content.

# QuizRoom specifications

Functional:

-- F01 -- Host must be able to register and log in. An authenticated host must be able to manage their own quizzes and game sessions.
 Players must be able to participate as guests wiithout creating an acoount.

-- F02 -- Hosts must be able to create edit and delete quizzes. A playable quiz must contain between 1 and 10 MCQs. Each question must contain a question text,
 four distinct options, and one option marked as correct.

-- F03 -- Hosts must be able to paste study notes and request a specified number of draft questions within the quiz size limit.
 Generated suggestions must include a question four answer options a proposed correct answer,
 a short explanation and a supporting session from the supplied source.

-- F04 -- Generated suggestions must be approved before they are presented to the host's review. Hosts must be able to edit, approve or discard suggested questions.
 Only approved questions can be used in a game. Editing an approved question must return the question to the suggested ("Draft") state.

-- F05 -- Hosts must be able to save quizzes and access them later. The library must distinguish between draft questions and approved questions
 and indicate whether a quiz is ready to use in a game.

-- F06 -- Hosts must be able to select a playable quiz and create a game room with a unique active room code.
 Guest players must be able to join the lobby using this code and a nickname.
 The host and players must see the participant list update when players connect or disconnect.

-- F07 -- The host must control when the game starts, when a question opens for answers, when answering closes, and when the next question begins.
 Only one question may be active at a time. There is no countdown timer.

-- F08 -- layers must be able to submit one answer to each open question and receive confirmation that their answer was accepted.
 Accepted answers cannot be changed. The system must reject submissions for closed questions and prevent duplicate submissions. 
 The host must see the number of submitted answers update during the round.

-- F09 -- After a question closes, the system must award one point for a correct answer and zero points for an incorrect or missing answer (There is no speed bonus).
 Players must then see the correct answer, the explanation when available, and the updated leaderboard.
 Players with equal scores must share the same rank.

-- F10 -- At the end of a game the system must display the final scoreboard and each participants total score.
 The host must be able to access the completed session s outcomes after the game has ended.

-- F11 -- There must be understable error feedbacl messages for possible errors such as invalid Room codes, unavailable roomns or invalid quiz data.



Technical: 







-----

Accounts signs tokens with one shared JWT_SECRET (HS256). The other four services check tokens with that same secret, so they never need to call Accounts on each request. The token's sub claim holds the host's id, which is how other services will know who owns a quiz or room.
