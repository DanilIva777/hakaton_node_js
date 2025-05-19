const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const pool = require('./models/client');

passport.use(new LocalStrategy({
	usernameField: 'email',
	}, async (email, password, done) => {
		try {
		const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
		
		if (res.rows.length === 0) {
			return done(null, false, { message: 'Неверный логин или пароль.' });
		}
		
		const user = res.rows[0];
		const isMatch = await bcrypt.compare(password, user.password);
		
		if (isMatch) {
			return done(null, user);
		} else {
			return done(null, false, { message: 'Неверный логин или пароль.' });
		}
		
		} catch (error) {
		return done(error);
		}
}));

passport.serializeUser((user, done) => {
	done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
	try {
		const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
		const user = res.rows[0];
		done(null, user);
	} catch (error) {
		done(error);
	}
});