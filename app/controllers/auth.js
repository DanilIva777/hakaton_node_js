const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const {
	Account,
	Role,
	Volonter,
	Partner,
	Bonus,
	NachBonus,
} = require("../models/modelsDB");

const isAuthenticated = async (req, res, next) => {
	try {
		// Получаем токен из заголовка запроса
		const token = req.headers.Authorization;

		// Если токен не предоставлен, возвращаем ошибку 401
		if (!token) {
			return res.status(401).json({ message: "Токен не предоставлен" });
		}

		// Ищем пользователя в базе данных по токену
		const acc = await Account.findOne({
			where: {
				token: token,
			},
		});

		// Если пользователь не найден, возвращаем ошибку 401
		if (!acc) {
			return res
				.status(401)
				.json({ message: "Неверный или истекший токен" });
		}

		// Пользователь авторизован, сохраняем данные пользователя в req и пропускаем запрос дальше
		req.user = acc;
		return next();
	} catch (error) {
		// В случае ошибки возвращаем 500
		console.error("Ошибка при проверке авторизации:", error);
		return res.status(500).json({ message: "Ошибка сервера" });
	}

	// Если что-то пошло не так и не вызван next(), возвращаем 403
	return res.sendStatus(403);
};

async function registerUser({ login, password, role_id }) {
	try {
		// Проверяем, существует ли пользователь с таким логином
		const existingUser = await Account.findOne({ where: { login } });
		if (existingUser) {
			return {
				success: false,
				message: "Пользователь с таким логином уже существует",
			};
		}
		console.log(login);

		// Проверяем, что role_id валиден
		const role = await Role.findOne({ where: { id: role_id } });
		if (!role) {
			return { success: false, message: "Указанная роль не существует" };
		}

		// Хешируем пароль
		const hashedPassword = await bcrypt.hash(password, 10);

		// Генерируем JWT-токен до создания пользователя
		const token = jwt.sign(
			{ id: null, login, role: role.naim }, // id будет добавлен после создания
			process.env.JWT_SECRET || "your_jwt_secret",
			{ expiresIn: "1h" }
		);
		// Создаем нового пользователя
		const newUser = await Account.create({
			login,
			password: hashedPassword,
			role_id,
			token, // Сохраняем токен сразу
		});

		return {
			success: true,
			user: {
				id: newUser.id,
				login: newUser.login,
				role: role.naim,
				token: token,
			},
		};
	} catch (error) {
		console.error(`Ошибка при регистрации login = ${login}:`, error);
		return { success: false, message: "Ошибка сервера" };
	}
}

async function authenticateUser(login, password) {
	try {
		const user = await Account.findOne({
			where: { login },
			include: [{ model: Role, as: "role" }],
			raw: true,
			nest: true,
		});

		if (!user || !(await bcrypt.compare(password, user.password))) {
			return { success: false, message: "Неверный логин или пароль" };
		}

		const token = jwt.sign(
			{ id: user.id, login: user.login, role: user.role.naim },
			process.env.JWT_SECRET || "your_jwt_secret",
			{ expiresIn: "1h" }
		);

		await Account.update({ token }, { where: { id: user.id } });

		return {
			success: true,
			user: {
				id: user.id,
				login: user.login,
				role: user.role.naim,
				token,
			},
		};
	} catch (error) {
		console.error(`Ошибка при аутентификации login = ${login}:`, error);
		return { success: false, message: "Ошибка сервера" };
	}
}

async function deleteUser(userId) {
	try {
		const user = await Account.findOne({
			where: { id: userId },
			include: [{ model: Role, as: "role" }],
		});

		if (!user) {
			return { success: false, message: "Пользователь не найден" };
		}

		await Volonter.destroy({ where: { id_acc: userId } });
		const partner = await Partner.findOne({ where: { id_acc: userId } });
		if (partner) {
			await Bonus.destroy({ where: { id_partner: partner.id } });
			await Partner.destroy({ where: { id_acc: userId } });
		}
		await NachBonus.destroy({ where: { id_volonter: userId } });

		await Account.destroy({ where: { id: userId } });

		return { success: true, message: "Пользователь успешно удален" };
	} catch (error) {
		console.error(
			`Ошибка при удалении пользователя id = ${userId}:`,
			error
		);
		return { success: false, message: "Ошибка сервера" };
	}
}

function logoutUser(req, res) {
	if (req.user) {
		Account.update({ token: null }, { where: { id: req.user.id } })
			.then(() => res.json({ message: "Выход выполнен" }))
			.catch((err) => {
				console.error("Ошибка при выходе:", err);
				res.status(500).json({ message: "Ошибка сервера" });
			});
	} else {
		res.status(401).json({ message: "Пользователь не авторизован" });
	}
}

module.exports = {
	authenticateUser,
	isAuthenticated,
	registerUser,
	deleteUser,
	logoutUser,
};
