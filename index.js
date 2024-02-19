import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import axios from "axios";
import ejs from "ejs";
import env from "dotenv";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import bcrypt from "bcrypt";
import session from "express-session";
import { Strategy as FacebookStrategy } from "passport-facebook";

const app = express();
const port = process.env.PORT || 3000;
env.config();

const API_ENDPOINT = "https://openlibrary.org/search.json?q=";

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

app.use(passport.initialize());
app.use(passport.session());

//create postgres link
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

let currentUsername = "";
let currentUserId = "";

async function getCurrentUser(userName) {
  let userId = await db.query("SELECT id FROM users WHERE email = ($1) ", [
    userName,
  ]);
  currentUserId = userId.rows[0];
  return currentUserId.id;
}

//render the home page upon get request.
app.get("/", async (req, res) => {
  res.render("index.ejs");
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/book-display",
  passport.authenticate("google", {
    successRedirect: "/book-display",
    failureRedirect: "/login",
  })
);

app.get(
  "/auth/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);

app.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect("/book-display");
  }
);

app.get("/book-display", async (req, res) => {
  try {
    if (req.isAuthenticated()) {
      const sortBy = req.query.sortBy || "title";
      const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
      currentUsername = req.user.email;
      currentUserId = await getCurrentUser(currentUsername);
      console.log(currentUserId);
      let query = `
        SELECT b.*, n.note, r.rating, r.date_read
        FROM book b
        LEFT JOIN notes n ON b.id = n.book_id
        LEFT JOIN rating r ON b.id = r.book_id
        WHERE b.user_id = $1
      `;

      switch (sortBy) {
        case "recency":
          query += ` ORDER BY r.date_read ${sortOrder}`;
          break;
        case "rating":
          query += ` ORDER BY r.rating ${sortOrder}`;
          break;
        case "title":
        default:
          query += ` ORDER BY b.title ${sortOrder}`;
          break;
      }
      const user_books_data = await db.query(query, [currentUserId]);
      const userBooks = user_books_data.rows;
      console.log(userBooks);
      res.render("book_display.ejs", {
        books: userBooks,
        username: req.user.name,
      });
    } else {
      res.redirect("/login");
    }
  } catch (err) {
    console.error(err);
  }
});

app.post("/search-books", async (req, res) => {
  const query = req.body.query;
  try {
    const response = await axios.get(API_ENDPOINT + query);

    const books = response.data.docs.slice(0, 10);
    res.render("search.ejs", { books: books, query: query });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

//Render login.ejs upon /login get request
app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/book-display",
    failureRedirect: "/login",
  })
);

//Take user input from form and search the openlibray api for the book
app.post("/choose-book", async (req, res) => {
  const { title, author, imgSrc } = req.body;

  try {
    res.render("book_review.ejs", {
      title: title,
      author: author,
      imgSrc: imgSrc,
    });
  } catch (err) {
    console.error(err);
  }
});

app.get("/search", (req, res) => {
  res.render("search-book.ejs");
});

app.post("/post-book", async (req, res) => {
  const { title, author, imgSrc, rating, notes, date } = req.body;
  console.log(rating, imgSrc, title, author, notes, date);
  const submittedDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let missingFields = [];

  if (!title) missingFields.push("title");
  if (!author) missingFields.push("author");
  if (!imgSrc) missingFields.push("imgSrc");
  if (rating === null || rating === undefined) missingFields.push("rating");
  if (!notes) missingFields.push("notes");
  if (!date) missingFields.push("date");

  // Check if there are any missing fields
  if (missingFields.length > 0) {
    const missingFieldsStr = missingFields.join(", ");
    return res.redirect(
      `/book-display?error=Missing required fields: ${encodeURIComponent(
        missingFieldsStr
      )}`
    );
  }

  // Checks if the submitted date is after today
  if (submittedDate > today) {
    return res.status(400).send("Date cannot be in the future.");
  }

  try {
    const bookInsert = await db.query(
      "INSERT INTO book(title, author_name, imgSrc, user_id) VALUES($1, $2, $3, $4) RETURNING id ",
      [title, author, imgSrc, currentUserId]
    );
    const bookId = bookInsert.rows[0].id;
    await db.query(
      "INSERT INTO rating(user_id, book_id, date_read, rating) VALUES($1, $2, $3, $4) ",
      [currentUserId, bookId, date, rating]
    );
    await db.query(
      "INSERT INTO notes(user_id, book_id, note) VALUES($1, $2, $3) ",
      [currentUserId, bookId, notes]
    );

    res.redirect("/book-display");
  } catch (err) {
    console.error(err);
  }
});

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query(
        "SELECT * FROM users WHERE username = $1 ",
        [username]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK,
      userProfileURL: process.env.GOOGLE_PROFILE_URL,
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password, name) VALUES ($1, $2,$3)",
            [profile.email, "google", profile.given_name]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.use(
  "facebook",
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
      callbackURL: process.env.FACEBOOK_CALLBACK,
      profileFields: ["id", "emails", "name"],
    },
    async (accessToken, refreshToken, profile, cb) => {
      // Check if user exists in DB or create a new one
      const email = profile.emails[0].value;
      console.log(profile);
      try {
        let result = await db.query("SELECT * FROM users WHERE email = $1", [
          email,
        ]);
        if (result.rows.length === 0) {
          // Insert new user with profile info
          result = await db.query(
            "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *",
            [email, "facebook", profile.name.givenName]
          );
        }
        cb(null, result.rows[0]);
      } catch (err) {
        cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
