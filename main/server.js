const express = require("express");
const app = express();
const port = 3000;
const http = require("http");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const {
	client,
	disconnectFromDatabase,
	connectToDatabase,
} = require("./app/models/client");
const {
	authenticateUser,
	registerUser,
	isAuthenticated,
	deleteUser,
} = require("./app/controllers/auth");
const session = require("express-session");
const {
	Role,
	Account,
	SettingTicket,
	GeneratedTicket,
	FilledTicket,
	HistoryOperation,
	TypeTransaction,
	UserInfo,
	VipCost,
	Game,
	SettingGame,
	sequelize,
} = require("./app/models/modelsDB");
const { Sequelize, Op, where } = require("sequelize");
const passport = require("passport");
const si = require("systeminformation");

app.use(passport.initialize());
app.use(
	"/.well-known/acme-challenge",
	express.static("/var/www/html/.well-known/acme-challenge")
);
app.use(express.json());
app.use(
	session({
		secret: "pAssW0rd",
		resave: false,
		saveUninitialized: true,
		cookie: {
			secure: true,
			httpOnly: true,
			sameSite: "strict",
		},
	})
);

app.use(
	cors({
		origin: "*",
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	})
);

function generateRandomNumber(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateTicketNumbers(count_number_row) {
	console.log(`Generating numbers for count_number_row: ${count_number_row}`);
	const totalNumbers = Array.isArray(count_number_row)
		? count_number_row.reduce((sum, num) => sum + num, 0)
		: count_number_row;
	const numbersToSelect = totalNumbers;
	if (!numbersToSelect || numbersToSelect <= 0) {
		console.error("Invalid parameters:", {
			count_number_row,
			numbersToSelect,
		});
		throw new Error("Invalid ticket parameters");
	}
	const arr_number = [];
	for (let i = 0; i < numbersToSelect; i++) {
		const randomNum = await generateRandomNumber(1, totalNumbers);
		if (!arr_number.includes(randomNum)) {
			arr_number.push(randomNum);
		} else {
			i--;
		}
	}
	return arr_number;
}

async function createGeneratedTicket(setting) {
	try {
		const currentDate = new Date();
		const arr_number = await generateTicketNumbers(
			setting.count_number_row
		);
		const countFillUser = setting.count_fill_user;

		if (countFillUser > arr_number.length) {
			throw new Error(
				"count_fill_user не может быть больше количества чисел в arr_number"
			);
		}

		const arr_true_number = [...arr_number]
			.sort(() => 0.5 - Math.random())
			.slice(0, countFillUser);

		const transaction = await sequelize.transaction();
		try {
			const newGeneratedTicket = await GeneratedTicket.create(
				{
					id_setting_ticket: setting.id,
					date_generated: currentDate.toISOString().split("T")[0],
					time_generated: currentDate.toTimeString().split(" ")[0],
					arr_number: arr_number,
					arr_true_number: arr_true_number,
				},
				{ transaction }
			);

			const filledTickets = await FilledTicket.findAll({
				where: {
					id_ticket: setting.id,
					is_win: null,
				},
				include: [{ model: UserInfo, as: "user" }],
				transaction,
			});

			// Prize calculation parameters
			const N = arr_number.length; // Total numbers available (based on arr_number)
			const K = countFillUser; // Numbers to select
			const ticketPrice = parseFloat(setting.price_ticket) || 100;
			const prizeFundRate = parseFloat(setting.percent_fond) / 100 || 0.5;
			const winningCategories = [4, 3, 2].filter((m) => m <= K); // Only include categories up to K

			// Combinatorial function
			function C(n, k) {
				if (k > n || k < 0) return 0;
				let res = 1;
				for (let i = 1; i <= k; i++) {
					res *= (n - i + 1) / i;
				}
				return res;
			}

			// Probability function
			function probability(m) {
				return (C(K, m) * C(N - K, K - m)) / C(N, K);
			}

			// Calculate prizes
			const totalPlayers = filledTickets.length;
			const totalFund = totalPlayers * ticketPrice * prizeFundRate;
			let remainingFund = totalFund;

			const baseAlpha = 0.752925;
			const n = winningCategories.length;
			const alphaDecay = 0.02 + 0.01 * n;
			const alpha = Math.max(
				baseAlpha - alphaDecay * Math.pow(n, 3),
				0.4
			);

			// Step 1: Calculate weights
			const weights = winningCategories.map((m) => {
				const P = probability(m);
				return P > 0 ? 1 / Math.pow(P, alpha) : 0;
			});

			const totalWeight = weights.reduce((a, b) => a + b, 0);

			// Step 2: Distribute prize fund
			const categories = winningCategories.map((m, index) => {
				const P = probability(m);
				const expectedWinners = totalPlayers * P;
				const weight = weights[index];

				let categoryPrize;
				if (index === n - 1) {
					categoryPrize = remainingFund; // Last category gets remaining fund
				} else {
					categoryPrize =
						totalWeight > 0
							? (totalFund * weight) / totalWeight
							: 0;
					remainingFund -= categoryPrize;
				}

				const minWinners = Math.max(expectedWinners, 1);
				const prizePerWinner = categoryPrize / minWinners;

				return {
					m,
					prizePerWinner,
				};
			});

			console.log("CATEGORIES", categories);
			for (const filledTicket of filledTickets) {
				const userInfo = filledTicket.user;

				// Count matches
				const userNumbers = filledTicket.filled_cell || [];
				const matches = userNumbers.filter((num) =>
					arr_true_number.includes(num)
				).length;

				let payout = 0;
				let isWin = false;

				// Check if the user has enough matches to win
				const winningCategory = categories.find(
					(cat) => cat.m <= matches
				);

				if (winningCategory) {
					const multiplier = parseFloat(filledTicket.multiplier) || 1;
					const priceFactor = multiplierFactors[multiplier] || 1; // Assumes multiplierFactors is defined
					payout = (
						winningCategory.prizePerWinner *
						priceFactor *
						multiplier
					).toFixed(2);
					isWin = true;

					// Update user balance
					userInfo.balance_real = Number(
						(
							parseFloat(
								userInfo.balance_real
									?.replace("$", "")
									.replace(/,/g, "") || "0"
							) + parseFloat(payout)
						).toFixed(2)
					);
					await userInfo.save({ transaction });

					// Record transaction
					const typeTransaction = await TypeTransaction.findOne({
						where: {
							naim: "Выигрыш в лото или играх (реальная валюта)",
						},
						transaction,
					});
					if (!typeTransaction) {
						throw new Error(
							"Тип транзакции 'Выигрыш в лото или играх (реальная валюта)' не найден"
						);
					}

					await HistoryOperation.create(
						{
							id_user: userInfo.id,
							change: payout,
							type_transaction: typeTransaction.id,
							is_succesfull: true,
							date: newGeneratedTicket.date_generated,
							time: newGeneratedTicket.time_generated,
						},
						{ transaction }
					);
				}

				// Update ticket status
				await filledTicket.update({ is_win: isWin }, { transaction });
			}

			await transaction.commit();
			return newGeneratedTicket;
		} catch (error) {
			await transaction.rollback();
			console.error("Ошибка при создании GeneratedTicket:", error);
			throw error;
		}
	} catch (error) {
		console.error(
			`Ошибка в createGeneratedTicket для setting ID: ${setting.id}:`,
			error
		);
		throw error;
	}
}

const multiplierFactors = {
	1.25: 2.5,
	1.5: 3,
	2: 4,
};

async function checkDiagonalMatch(
	arrMultiplierNumber,
	settingId,
	countNumberRow
) {
	const size = countNumberRow[0];
	if (arrMultiplierNumber.length !== size) {
		return false;
	}

	const latestGeneratedTicket = await GeneratedTicket.findOne({
		where: { id_setting_ticket: settingId },
		order: [
			["date_generated", "DESC"],
			["time_generated", "DESC"],
		],
	});

	if (!latestGeneratedTicket || !latestGeneratedTicket.arr_true_number) {
		return false;
	}

	const trueNumbers = latestGeneratedTicket.arr_true_number;

	for (let i = 0; i < size; i++) {
		const diagonalIndex = i * size + i;
		if (arrMultiplierNumber[i] !== trueNumbers[diagonalIndex]) {
			return false;
		}
	}
	return true;
}

let activeSettingsCache = [];
let intervalJobs = {};

function timeToMilliseconds(time) {
	try {
		if (!time) return 0;

		const parts = String(time)
			.split(":")
			.map((p) => parseInt(p, 10) || 0);

		while (parts.length < 3) parts.push(0);
		const [hours, minutes, seconds] = parts;

		if (hours > 23 || minutes > 59 || seconds > 59) {
			throw new Error("Invalid time values");
		}

		return (hours * 3600 + minutes * 60 + seconds) * 1000;
	} catch (error) {
		console.error(`Ошибка конвертации времени '${time}':`, error);
		return 0;
	}
}

async function updateSingleSetting(settingId) {
	try {
		const setting = await SettingTicket.findOne({
			where: { id: settingId },
			raw: true,
		});

		if (!setting) {
			console.log(`Настройка ${settingId} не найдена, очистка таймера`);
			if (intervalJobs[settingId]) {
				clearInterval(intervalJobs[settingId]);
				delete intervalJobs[settingId];
			}
			return;
		}

		const existingIndex = activeSettingsCache.findIndex(
			(s) => s.id === settingId
		);

		if (setting.is_start) {
			if (existingIndex >= 0) {
				const cachedSetting = activeSettingsCache[existingIndex];

				if (
					cachedSetting.time !== setting.time ||
					JSON.stringify(cachedSetting.count_number_row) !==
						JSON.stringify(setting.count_number_row)
				) {
					console.log(
						`Обнаружены изменения в настройке ${settingId}`
					);
					activeSettingsCache[existingIndex] = setting;
					createIntervalForSetting(setting);
				}
			} else {
				activeSettingsCache.push(setting);
				createIntervalForSetting(setting);
			}
		} else {
			if (existingIndex >= 0) {
				activeSettingsCache.splice(existingIndex, 1);
			}
			if (intervalJobs[settingId]) {
				console.log(`Остановка таймера для настройки ${settingId}`);
				clearInterval(intervalJobs[settingId]);
				delete intervalJobs[settingId];
			}
		}
	} catch (error) {
		console.error(`Ошибка обновления настройки ${settingId}:`, error);
	}
}

function createIntervalForSetting(setting) {
	try {
		console.log(
			`[${new Date().toISOString()}] Обработка настройки ${setting.id}`
		);

		if (intervalJobs[setting.id]) {
			clearInterval(intervalJobs[setting.id]);
			console.log(`Удалён предыдущий таймер для ${setting.id}`);
		}

		if (!setting.is_start) {
			console.log(`Настройка ${setting.id} не активна, пропуск`);
			return;
		}

		if (!setting.time || !setting.count_number_row) {
			console.warn(
				`Некорректные параметры для настройки ${setting.id}`,
				setting
			);
			return;
		}

		const intervalMs = timeToMilliseconds(setting.time);
		if (intervalMs <= 0) {
			console.warn(
				`Некорректный интервал для ${setting.id}: ${setting.time}`
			);
			return;
		}

		intervalJobs[setting.id] = setTimeout(async () => {
			console.log(
				`[${new Date().toISOString()}] Генерация билета для ${
					setting.id
				}`
			);
			try {
				await createGeneratedTicket(setting);
			} catch (error) {
				console.error(`Ошибка генерации билета ${setting.id}:`, error);
			}
		}, intervalMs);

		console.log(
			`Установлен новый интервал для ${setting.id}: ${setting.time} (${intervalMs}ms)`
		);
	} catch (error) {
		console.error(
			`Критическая ошибка создания таймера ${setting.id}:`,
			error
		);
	}
}

async function updateSettingsCache() {
	try {
		const activeSettings = await SettingTicket.findAll({
			where: { is_start: true },
		});
		const newSettings = activeSettings.map((s) => s.toJSON());
		console.log("Fetched active settings:", newSettings);

		for (const setting of newSettings) {
			const cachedSetting = activeSettingsCache.find(
				(s) => s.id === setting.id
			);
			if (!cachedSetting || cachedSetting.time !== setting.time) {
				createIntervalForSetting(setting);
			}
		}

		const newSettingIds = newSettings.map((s) => s.id);
		for (const settingId of Object.keys(intervalJobs)) {
			if (!newSettingIds.includes(parseInt(settingId))) {
				clearInterval(intervalJobs[settingId]);
				console.log(
					`Cleared interval for removed setting ID: ${settingId}`
				);
				delete intervalJobs[settingId];
			}
		}

		activeSettingsCache = newSettings;
		console.log("Updated settings cache:", activeSettingsCache);
	} catch (error) {
		console.error("Error updating settings cache:", error);
	}
}

function scheduleGeneratedTickets() {
	console.log(
		"Starting scheduleGeneratedTickets at:",
		new Date().toISOString()
	);
	console.log(
		"Server timezone:",
		Intl.DateTimeFormat().resolvedOptions().timeZone
	);
}

console.log("Initializing server at:", new Date().toISOString());
scheduleGeneratedTickets();

const isAdmin = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const acc = await Account.findOne({
			where: { token: token },
		});

		if (acc.role_id == 1) {
			return next();
		}
		res.sendStatus(403);
	} catch (err) {
		res.sendStatus(403);
	}
};

const isUser = async (req, res, next) => {
	try {
		const token = req.headers.authorization;
		const acc = await Account.findOne({
			where: { token: token },
		});
		if (acc.role_id == 2) {
			return next();
		}
		res.sendStatus(403);
	} catch (err) {
		res.sendStatus(403);
	}
};

app.post("/register_user", async (req, res) => {
	const { login, password, mail } = req.body;

	if (!login || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}

	const transaction = await sequelize.transaction();
	try {
		const result = await registerUser(
			{ login, password, role_id: 2, mail },
			transaction
		);
		if (!result.success) {
			await transaction.rollback();
			return res.status(400).json({ message: result.message });
		}

		const newUserInfo = await UserInfo.create(
			{
				id_acc: result.user.id,
				balance_real: 0,
				balance_virtual: 0,
			},
			{ transaction }
		);

		await transaction.commit();

		res.json({
			success: true,
			user: {
				id: result.user.id,
				login: result.user.login,
				mail: result.user.mail,
				role_id: result.user.role_id,
				balance_real: newUserInfo.balance_real,
				balance_bonus: newUserInfo.balance_virtual,
			},
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при регистрации:", error);
		res.status(500).json({ message: "Ошибка сервера" });
	}
});

app.get("/auth_test", isAuthenticated, async (req, res) => {
	res.json({ text: "Пользователь авторизован" });
});

app.post("/login", async (req, res) => {
	const { identifier, password } = req.body;
	if (!identifier || !password) {
		return res.status(400).json({ message: "Не все поля указаны" });
	}
	try {
		const result = await authenticateUser({ identifier, password });
		if (result.success) {
			res.json(result.user);
		} else {
			res.status(401).json({ message: result.message });
		}
	} catch (error) {
		console.error("Ошибка при логине:", error);
		res.status(500).json({ message: "Ошибка подключения к базе данных" });
	}
});

app.put(
	"/update-mail",
	passport.authenticate("jwt", { session: false }),
	async (req, res) => {
		const { newMail } = req.body;
		if (!newMail) {
			return res.status(400).json({ message: "Новая почта не указана" });
		}

		const result = await updateUserMail(req.user.id, newMail);
		if (result.success) {
			res.json({ message: result.message });
		} else {
			res.status(400).json({ message: result.message });
		}
	}
);

app.delete(
	"/user/:id",
	passport.authenticate("jwt", { session: false }),
	isAdmin,
	async (req, res) => {
		const userId = parseInt(req.params.id, 10);
		if (isNaN(userId)) {
			return res
				.status(400)
				.json({ message: "Некорректный ID пользователя" });
		}
		const result = await deleteUser(userId);
		if (result.success) {
			res.json({ message: result.message });
		} else {
			res.status(400).json({ message: result.message });
		}
	}
);

app.get("/vip_offers", async (req, res) => {
	try {
		const vipOffers = await VipCost.findAll({
			order: [["count_day", "ASC"]],
			attributes: ["id", "naim", "price", "count_day"],
			raw: true,
		});

		if (!vipOffers || vipOffers.length === 0) {
			return res.status(404).json({
				success: false,
				message: "VIP предложения не найдены",
			});
		}

		const formattedOffers = vipOffers.map((offer) => ({
			...offer,
			price: parseFloat(offer.price.replace(/[^0-9.]/g, "")),
		}));

		res.status(200).json({
			success: true,
			offers: formattedOffers,
		});
	} catch (error) {
		console.error("Ошибка при получении vip предложений:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.get("/user_info", isUser, async (req, res) => {
	const transaction = await sequelize.transaction();
	try {
		const token = req.headers.authorization.replace("Bearer ", "");

		const account = await Account.findOne({
			where: { token },
			attributes: ["id", "role_id"],
			transaction,
		});

		const userId = account.id;

		if (!account) {
			await transaction.rollback();
			return res.status(401).json({
				success: false,
				message: "Пользователь не авторизован",
			});
		}

		const targetUserId =
			userId && account.role_id === 1 ? userId : account.id;

		if (userId && isNaN(targetUserId)) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: "Некорректный ID пользователя",
			});
		}

		const targetAccount = await Account.findOne({
			where: { id: targetUserId },
			attributes: ["id", "login", "mail", "role_id"],
			include: [
				{
					model: Role,
					as: "role",
					attributes: ["naim"],
				},
			],
			transaction,
		});

		if (!targetAccount) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Пользователь не найден",
			});
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: targetUserId },
			attributes: [
				"id",
				"balance_real",
				"balance_virtual",
				"is_vip",
				"vip_stop_date",
				"category_vip",
			],
			include: [
				{
					model: VipCost,
					as: "vip_cost",
					attributes: ["naim", "price", "count_day", "category"],
					required: false,
				},
			],
			transaction,
		});

		if (!userInfo) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Информация о пользователе не найдена",
			});
		}

		const historyOperations = await HistoryOperation.findAll({
			where: { id_user: userInfo.id },
			attributes: [
				"id",
				"change",
				"is_succesfull",
				"date",
				"time",
				"type_transaction",
			],
			include: [
				{
					model: TypeTransaction,
					as: "transaction_type",
					attributes: ["naim"],
				},
			],
			order: [
				["date", "DESC"],
				["time", "DESC"],
			],
			transaction,
		});

		const activeGame = await Game.findOne({
			where: { id_user: userInfo.id, is_active: true },
			attributes: [
				"id",
				"grid",
				"current_number",
				"skip_count",
				"current_move_cost",
				"total_bets",
				"total_payouts",
				"date_created",
				"time_created",
			],
			include: [
				{
					model: SettingGame,
					as: "setting",
					attributes: [
						"base_move_cost",
						"initial_skill_cost",
						"payout_row_col",
						"payout_block",
						"payout_complete",
						"initial_filled_cells",
					],
				},
			],
			transaction,
		});

		const filledTickets = await FilledTicket.findAll({
			where: { id_user: userInfo.id },
			attributes: [
				"id",
				"date",
				"time",
				"filled_cell",
				"is_win",
				"id_ticket",
				"multiplier",
				"multiplier_numbers",
			],
			include: [
				{
					model: SettingTicket,
					as: "setting_ticket",
					attributes: [
						"id",
						"time",
						"price_ticket",
						"count_number_row",
						"count_fill_user",
					],
				},
			],
			transaction,
		});

		await transaction.commit();

		const response = {
			success: true,
			user: {
				account: {
					id: targetAccount.id,
					login: targetAccount.login,
					mail: targetAccount.mail,
					role: targetAccount.role?.naim || "Неизвестная роль",
				},
				info: {
					balance_real: parseFloat(
						userInfo.balance_real
							?.replace("$", "")
							.replace(/,/g, "") || "0"
					),
					balance_virtual: parseFloat(
						userInfo.balance_virtual
							?.replace("$", "")
							.replace(/,/g, "") || "0"
					),
					is_vip: userInfo.is_vip || false,
					vip_stop_date: userInfo.vip_stop_date || null,
					vip_category: userInfo.vip_cost
						? {
								id: userInfo.vip_cost.id,
								name: userInfo.vip_cost.naim,
								price: parseFloat(userInfo.vip_cost.price) || 0,
								count_day: userInfo.vip_cost.count_day || 0,
								category: userInfo.vip_cost.category || 0,
						  }
						: null,
				},
				history_operations: historyOperations.map((op) => ({
					id: op.id,
					amount:
						parseFloat(
							op.change?.replace("$", "").replace(/,/g, "")
						) || 0,
					is_successful: op.is_succesfull,
					date: op.date,
					time: op.time,
					operation_type:
						op.transaction_type?.naim || "Неизвестная операция",
				})),
				active_game: activeGame
					? {
							id: activeGame.id,
							grid: activeGame.grid,
							current_number: activeGame.current_number,
							skip_count: activeGame.skip_count,
							current_move_cost:
								parseFloat(activeGame.current_move_cost) || 0,
							total_bets: parseFloat(activeGame.total_bets) || 0,
							total_payouts:
								parseFloat(activeGame.total_payouts) || 0,
							date_created: activeGame.date_created,
							time_created: activeGame.time_created,
							setting: activeGame.setting
								? {
										base_move_cost:
											parseFloat(
												activeGame.setting
													.base_move_cost
											) || 0,
										initial_skill_cost:
											parseFloat(
												activeGame.setting
													.initial_skill_cost
											) || 0,
										payout_row_col:
											parseFloat(
												activeGame.setting
													.payout_row_col
											) || 0,
										payout_block:
											parseFloat(
												activeGame.setting.payout_block
											) || 0,
										payout_complete:
											parseFloat(
												activeGame.setting
													.payout_complete
											) || 0,
										initial_filled_cells:
											activeGame.setting
												.initial_filled_cells || 0,
								  }
								: null,
					  }
					: null,
				filled_tickets: filledTickets.map((ticket) => ({
					id: ticket.id,
					date: ticket.date,
					time: ticket.time,
					filled_cell: ticket.filled_cell,
					is_win: ticket.is_win,
					multiplier: parseFloat(ticket.multiplier) || 0,
					multiplier_numbers: ticket.multiplier_numbers,
					setting: ticket.setting_ticket
						? {
								id: ticket.setting_ticket.id,
								time: ticket.setting_ticket.time,
								price_ticket:
									parseFloat(
										String(
											ticket.setting_ticket.price_ticket
										).replace(/[^0-9.]/g, "")
									) || 0,
								count_number_row:
									ticket.setting_ticket.count_number_row,
								count_fill_user:
									ticket.setting_ticket.count_fill_user,
						  }
						: null,
				})),
			},
		};

		res.status(200).json(response);
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при получении данных пользователя:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: undefined,
		});
	}
});

app.get("/current_tickets", async (req, res) => {
	try {
		const activeSettings = await SettingTicket.findAll({
			where: { is_start: true },
			include: [
				{
					model: GeneratedTicket,
					as: "generated_tickets",
					required: false, // LEFT JOIN, чтобы получить SettingTicket даже без GeneratedTicket
				},
			],
			// Дополнительная фильтрация на уровне Sequelize для исключения SettingTicket с существующими GeneratedTicket
			/*where: {
				is_start: true,
				"$generated_tickets.id$": null, // Убедимся, что нет связанных GeneratedTicket
			},*/
		});
		return res.status(200).json(activeSettings);
		if (!activeSettings || activeSettings.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No active ticket settings found",
			});
		}

		const ticketsPromises = activeSettings.map((setting) =>
			GeneratedTicket.findOne({
				where: { id_setting_ticket: setting.id },
				attributes: [
					"id",
					"id_setting_ticket",
					"date_generated",
					"time_generated",
					"arr_number",
				],
				include: [
					{
						model: SettingTicket,
						as: "setting_ticket",
						attributes: [
							"id",
							"time",
							"price_ticket",
							"count_number_row",
							"count_fill_user",
							"arr_number",
						],
					},
				],
				order: [
					["date_generated", "DESC"],
					["time_generated", "DESC"],
				],
				limit: 1,
			})
		);

		const ticketsResults = await Promise.all(ticketsPromises);
		const validTickets = ticketsResults.filter((ticket) => ticket !== null);

		if (validTickets.length === 0) {
			return res.status(404).json({
				success: false,
				message: "No generated tickets found for active settings",
			});
		}

		const formattedTickets = validTickets.map((ticket) => ({
			id: ticket.id,
			setting_ticket_id: ticket.id_setting_ticket,
			date_generated: ticket.date_generated,
			time_generated: ticket.time_generated,
			numbers: ticket.arr_number,
			setting: ticket.setting_ticket
				? {
						id: ticket.setting_ticket.id,
						time: ticket.setting_ticket.time,
						price: parseFloat(
							String(ticket.setting_ticket.price_ticket).replace(
								/[^0-9.]/g,
								""
							)
						),
						count_number_row:
							ticket.setting_ticket.count_number_row,
						count_fill_user: ticket.setting_ticket.count_fill_user,
				  }
				: null,
		}));

		res.status(200).json({
			success: true,
			tickets: formattedTickets,
		});
	} catch (error) {
		console.error("Error fetching current tickets:", error);
		res.status(500).json({
			success: false,
			message: "Server error: " + error.message,
		});
	}
});

app.post("/buy_vip", isUser, async (req, res) => {
	req.setTimeout(30000);
	const transaction = await sequelize.transaction();

	try {
		const { vip_offer_id, confirm_downgrade } = req.body;
		const token = req.headers.authorization.replace("Bearer ", "");

		const account = await Account.findOne({
			where: { token },
			attributes: ["id"],
			transaction,
		});

		if (!account) {
			await transaction.rollback();
			return res.status(401).json({
				success: false,
				message: "Требуется авторизация",
			});
		}

		const user = await UserInfo.findOne({
			where: { id_acc: account.id },
			attributes: [
				"id",
				"balance_virtual",
				"is_vip",
				"vip_stop_date",
				"category_vip",
			],
			transaction,
			lock: transaction.LOCK.UPDATE,
			skipLocked: true,
		});

		if (!user) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Профиль не найден",
			});
		}

		const offerId = parseInt(vip_offer_id, 10);
		if (isNaN(offerId)) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: "Неверный формат ID предложения",
			});
		}

		const vipOffer = await VipCost.findByPk(offerId, {
			attributes: ["id", "price", "count_day", "category"],
			transaction,
			raw: true,
		});

		const TRANSACTION_TYPE_MAP = {
			1: "Покупка VIP (Мещанин)",
			2: "Покупка VIP (Буржуй)",
			3: "Покупка VIP (Олигарх)",
		};

		if (!vipOffer || !TRANSACTION_TYPE_MAP[offerId]) {
			await transaction.rollback();
			return res.status(404).json({
				success: false,
				message: "Предложение не найдено",
			});
		}

		const currentVipCategory = user.category_vip || 0;
		const newVipCategory = vipOffer.category;

		if (user.is_vip && newVipCategory < currentVipCategory) {
			if (!confirm_downgrade) {
				await transaction.rollback();
				return res.status(400).json({
					success: false,
					message:
						"Новая категория VIP ниже текущей. Подтвердите покупку.",
					requires_confirmation: true,
					current_category: currentVipCategory,
					new_category: newVipCategory,
				});
			}
		}

		const priceRaw = Array.isArray(vipOffer.price)
			? vipOffer.price[0]
			: vipOffer.price;
		const price = parseFloat(priceRaw.replace(/[^0-9.]/g, ""));

		if (isNaN(price) || price <= 0) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: `Неверное значение цены: ${priceRaw}`,
			});
		}

		if (user.balance_virtual < price) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: "Недостаточно средств",
			});
		}

		const countDay = parseInt(vipOffer.count_day, 10);
		if (isNaN(countDay) || countDay <= 0) {
			await transaction.rollback();
			return res.status(400).json({
				success: false,
				message: `Неверное значение длительности: ${vipOffer.count_day}`,
			});
		}

		const newVipStop = Sequelize.literal(
			`NOW() + INTERVAL '${countDay} DAYS'`
		);

		await UserInfo.update(
			{
				balance_virtual: Sequelize.literal(
					`CAST(balance_virtual AS NUMERIC) - CAST(${price} AS NUMERIC)`
				),
				vip_stop_date: newVipStop,
				is_vip: true,
				category_vip: vipOffer.category,
			},
			{
				where: { id: user.id },
				transaction,
			}
		);

		const [historyRecord] = await Promise.all([
			HistoryOperation.create(
				{
					id_user: user.id,
					change: -price,
					type_transaction: offerId + 16,
					is_succesfull: true,
					date: Sequelize.fn("NOW"),
					time: Sequelize.fn("NOW"),
				},
				{ transaction }
			),
			TypeTransaction.findOrCreate({
				where: { naim: TRANSACTION_TYPE_MAP[offerId] },
				defaults: { naim: TRANSACTION_TYPE_MAP[offerId] },
				transaction,
			}),
		]);

		await transaction.commit();

		const updatedUser = await UserInfo.findOne({
			where: { id: user.id },
			attributes: ["vip_stop_date", "category_vip"],
		});

		res.json({
			success: true,
			new_balance:
				parseFloat(user.balance_virtual.replace(/[$,]/g, "")) - price,
			vip_until: updatedUser.vip_stop_date,
			vip_category: updatedUser.category_vip,
		});
	} catch (error) {
		await transaction.rollback();
		console.error(
			`[${new Date().toISOString()}] Ошибка покупки VIP:`,
			error.stack || error
		);
		res.status(500).json({
			success: false,
			message: "Внутренняя ошибка сервера",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: undefined,
		});
	}
});

app.post("/setting_ticket", isAdmin, async (req, res) => {
	try {
		const {
			time,
			price_ticket,
			percent_fond,
			is_start,
			count_number_row,
			count_fill_user,
		} = req.body;

		if (time && !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
			return res.status(400).json({
				message: "Неверный формат времени. Используйте HH:mm:ss",
			});
		}

		if (!Array.isArray(count_number_row) || count_number_row.length === 0) {
			return res.status(400).json({
				message: "count_number_row должен быть непустым массивом",
			});
		}

		const transaction = await sequelize.transaction();

		try {
			const newSettingTicket = await SettingTicket.create(
				{
					time: time || null,
					price_ticket: price_ticket || null,
					percent_fond: percent_fond || null,
					is_start: is_start || false,
					count_number_row: count_number_row || null,
					count_fill_user: count_fill_user || null,
					arr_number: await generateTicketNumbers(count_number_row),
				},
				{ transaction }
			);

			await transaction.commit();
			const intervalMs = timeToMilliseconds(newSettingTicket.time);
			setTimeout(async () => {
				console.log(
					`[${new Date().toISOString()}] Генерация билета для ${
						newSettingTicket.id
					}`
				);
				try {
					await createGeneratedTicket(newSettingTicket);
				} catch (error) {
					console.error(
						`Ошибка генерации билета ${newSettingTicket.id}:`,
						error
					);
				}
			}, intervalMs);

			res.status(201).json({
				success: true,
				settingTicket: newSettingTicket.toJSON(),
			});
		} catch (error) {
			await transaction.rollback();
			throw error;
		}
	} catch (error) {
		console.error("Ошибка при создании настройки билета:", error);
		res.status(500).json({
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.put("/update-setting_ticket/:id", isAdmin, async (req, res) => {
	const transaction = await sequelize.transaction();
	try {
		const settingTicketId = parseInt(req.params.id, 10);

		if (isNaN(settingTicketId)) {
			await transaction.rollback();
			return res.status(400).json({
				message: "Некорректный ID настройки",
			});
		}

		if (req.body.time && !/^\d{2}:\d{2}:\d{2}$/.test(req.body.time)) {
			await transaction.rollback();
			return res.status(400).json({
				message: "Неверный формат времени. Используйте HH:mm:ss",
			});
		}

		if (
			req.body.count_number_row &&
			(!Array.isArray(req.body.count_number_row) ||
				req.body.count_number_row.length === 0)
		) {
			await transaction.rollback();
			return res.status(400).json({
				message: "count_number_row должен быть непустым массивом",
			});
		}

		const settingTicket = await SettingTicket.findOne({
			where: { id: settingTicketId },
			transaction,
		});

		if (!settingTicket) {
			await transaction.rollback();
			return res.status(404).json({
				message: "Настройка не найдена",
			});
		}

		const updateData = {
			time:
				req.body.time !== undefined
					? req.body.time
					: settingTicket.time,
			price_ticket: req.body.price_ticket ?? settingTicket.price_ticket,
			percent_fond: req.body.percent_fond ?? settingTicket.percent_fond,
			is_start: req.body.is_start ?? settingTicket.is_start,
			count_number_row:
				req.body.count_number_row ?? settingTicket.count_number_row,
			count_fill_user:
				req.body.count_fill_user ?? settingTicket.count_fill_user,
		};

		await settingTicket.update(updateData, { transaction });
		await transaction.commit();

		res.json({
			success: true,
			settingTicket: settingTicket.toJSON(),
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при обновлении настройки:", error);
		res.status(500).json({
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.get("/filled_ticket", isUser, async (req, res) => {
	try {
		const token = req.headers.authorization;

		const account = await Account.findOne({
			where: { token },
			attributes: ["id"],
		});
		if (!account) {
			return res.status(401).json({
				success: false,
				message: "Пользователь не найден",
			});
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
			attributes: ["id"],
		});
		if (!userInfo) {
			return res.status(404).json({
				success: false,
				message: "Информация о пользователе не найдена",
			});
		}

		const filledTickets = await FilledTicket.findAll({
			where: { id_user: userInfo.id },
			attributes: [
				"id",
				"id_user",
				"id_ticket",
				"date",
				"time",
				"filled_cell",
				"is_win",
				"id_history_operation",
			],
			order: [
				["date", "DESC"],
				["time", "DESC"],
			],
			include: [
				{
					model: SettingTicket,
					as: "setting_ticket",
					attributes: [
						"id",
						"price_ticket",
						"count_number_row",
						"count_fill_user",
					],
					include: [
						{
							model: GeneratedTicket,
							as: "generated_tickets",
							attributes: [
								"id",
								"date_generated",
								"time_generated",
								"arr_number",
								"arr_true_number",
							],
							// Получаем только последний сгенерированный билет
							separate: true, // Выполняет отдельный запрос для оптимизации
							order: [
								["date_generated", "DESC"],
								["time_generated", "DESC"],
							],
							limit: 1,
						},
					],
				},
				{
					model: HistoryOperation,
					as: "history",
					attributes: [
						"id",
						"change",
						"type_transaction",
						"is_succesfull",
					],
					include: [
						{
							model: TypeTransaction,
							as: "transaction_type",
							attributes: ["id", "naim"],
						},
					],
				},
			],
		});

		const formattedTickets = filledTickets.map((ticket) => ({
			id: ticket.id,
			user_id: ticket.id_user,
			ticket_id: ticket.id_ticket,
			date: ticket.date,
			time: ticket.time,
			filled_cell: ticket.filled_cell,
			is_win: ticket.is_win,
			history_operation_id: ticket.id_history_operation,
			setting: ticket.setting_ticket
				? {
						id: ticket.setting_ticket.id,
						price: parseFloat(
							String(ticket.setting_ticket.price_ticket).replace(
								/[^0-9.]/g,
								""
							)
						),
						count_number_row:
							ticket.setting_ticket.count_number_row,
						count_fill_user: ticket.setting_ticket.count_fill_user,
				  }
				: null,
			history: ticket.history
				? {
						id: ticket.history.id,
						change: parseFloat(
							String(ticket.history.change).replace(
								/[^0-9.]/g,
								""
							)
						),
						type_transaction: ticket.history.transaction_type
							? ticket.history.transaction_type.naim
							: null,
						is_successful: ticket.history.is_succesfull,
				  }
				: null,
			generated_ticket: ticket.setting_ticket?.generated_tickets?.[0]
				? {
						id: ticket.setting_ticket.generated_tickets[0].id,
						date_generated:
							ticket.setting_ticket.generated_tickets[0]
								.date_generated,
						time_generated:
							ticket.setting_ticket.generated_tickets[0]
								.time_generated,
						arr_number:
							ticket.setting_ticket.generated_tickets[0]
								.arr_number,
						arr_true_number:
							ticket.setting_ticket.generated_tickets[0]
								.arr_true_number,
				  }
				: null,
		}));

		res.status(200).json({
			success: true,
			tickets: formattedTickets,
		});
	} catch (error) {
		console.error("Ошибка при получении талонов пользователя:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.post("/filled_ticket", isUser, async (req, res) => {
	try {
		const {
			id_setting_ticket,
			arr_number,
			arr_multiplier_number,
			multiplier,
			price_multiplier,
		} = req.body;
		const token = req.headers.authorization;

		if (
			!id_setting_ticket ||
			!Array.isArray(arr_number) ||
			arr_number.length === 0
		) {
			return res.status(400).json({
				message: "Не указаны id_setting_ticket или arr_number",
			});
		}

		if (
			isNaN(multiplier) ||
			multiplier <= 0 ||
			isNaN(price_multiplier) ||
			price_multiplier <= 0
		) {
			return res.status(400).json({
				message:
					"multiplier и price_multiplier должны быть положительными числами",
			});
		}

		const account = await Account.findOne({ where: { token } });
		if (!account) {
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
		});
		if (!userInfo) {
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		const settingTicket = await SettingTicket.findOne({
			where: {
				id: id_setting_ticket,
				is_start: true,
			},
		});
		if (!settingTicket) {
			return res.status(404).json({
				message: "Настройка билета не найдена или не активна",
			});
		}

		const basePrice = parseFloat(
			String(settingTicket.price_ticket).replace(/[^0-9.]/g, "")
		);
		if (isNaN(basePrice) || basePrice <= 0) {
			return res
				.status(400)
				.json({ message: "Некорректная цена билета" });
		}
		const totalPrice = (basePrice * price_multiplier).toFixed(2);

		const currentBalance = parseFloat(
			String(userInfo.balance_real).replace(/[^0-9.]/g, "")
		);
		if (currentBalance < totalPrice) {
			return res
				.status(400)
				.json({ message: "Недостаточно средств на балансе" });
		}

		const countFillUser = settingTicket.count_fill_user;
		if (arr_number.length !== countFillUser) {
			return res.status(400).json({
				message: `Ожидается ${countFillUser} чисел в arr_number`,
			});
		}
		const totalNumbers = settingTicket.count_number_row.reduce(
			(sum, num) => sum + num,
			0
		);
		const uniqueNumbers = new Set(arr_number);
		if (uniqueNumbers.size !== countFillUser) {
			return res.status(400).json({
				message: "Числа в arr_number должны быть уникальными",
			});
		}
		for (const num of arr_number) {
			if (!Number.isInteger(num) || num < 1 || num > totalNumbers) {
				return res.status(400).json({
					message: `Некорректное число в arr_number: ${num}`,
				});
			}
		}

		if (
			Array.isArray(arr_multiplier_number) &&
			arr_multiplier_number.length !== 0
		) {
			const gridSize = settingTicket.count_number_row[0];
			if (arr_multiplier_number.length !== gridSize) {
				return res.status(400).json({
					message: `Ожидается ${gridSize} чисел в arr_multiplier_number для диагонали`,
				});
			}
			for (const num of arr_multiplier_number) {
				if (!Number.isInteger(num) || num < 1 || num > totalNumbers) {
					return res.status(400).json({
						message: `Некорректное число в arr_multiplier_number: ${num}`,
					});
				}
			}
		}

		const transaction = await sequelize.transaction();
		try {
			userInfo.balance_real = (currentBalance - totalPrice).toFixed(2);
			await userInfo.save({ transaction });

			const typeTransaction = await TypeTransaction.findOne({
				where: { naim: "Ставка в лото или играх (реальная валюта)" },
				transaction,
			});
			if (!typeTransaction) {
				throw new Error(
					"Тип транзакции 'Ставка в лото или играх (реальная валюта)' не найден"
				);
			}
			const currentDate = new Date();
			const history = await HistoryOperation.create(
				{
					id_user: userInfo.id,
					change: (-totalPrice).toFixed(2),
					date: currentDate.toISOString().split("T")[0],
					time: currentDate.toTimeString().split(" ")[0],
					type_transaction: typeTransaction.id,
				},
				{ transaction }
			);

			const newFilledTicket = await FilledTicket.create(
				{
					id_user: userInfo.id,
					id_ticket: id_setting_ticket,
					date: currentDate.toISOString().split("T")[0],
					time: currentDate.toTimeString().split(" ")[0],
					filled_cell: arr_number,
					multiplier: multiplier,
					multiplier_numbers: arr_multiplier_number,
					id_history_operation: history.id,
					is_win: null,
				},
				{ transaction }
			);

			await transaction.commit();

			res.status(201).json({
				success: true,
				filledTicket: {
					id: newFilledTicket.id,
					id_user: newFilledTicket.id_user,
					id_ticket: newFilledTicket.id_ticket,
					date: newFilledTicket.date,
					time: newFilledTicket.time,
					filled_cell: newFilledTicket.filled_cell,
					multiplier_numbers: newFilledTicket.multiplier_numbers,
					multiplier: newFilledTicket.multiplier,
					is_win: newFilledTicket.is_win,
				},
				newBalance: userInfo.balance_real,
			});
		} catch (error) {
			await transaction.rollback();
			console.error("Ошибка при создании FilledTicket:", error);
			return res.status(500).json({
				message: "Ошибка при создании билета: " + error.message,
			});
		}
	} catch (error) {
		console.error("Ошибка в маршруте /filled_ticket:", error);
		res.status(500).json({ message: "Ошибка сервера: " + error.message });
	}
});

app.get("/history_operation", isUser, async (req, res) => {
	try {
		const token = req.headers.authorization.replace("Bearer ", "");
		const { page = 1, limit = 10, type_operation } = req.query;

		const parsedPage = parseInt(page);
		const parsedLimit = parseInt(limit);

		if (isNaN(parsedPage)) {
			return res.status(400).json({
				success: false,
				message: "Некорректный номер страницы",
			});
		}

		if (isNaN(parsedLimit)) {
			return res.status(400).json({
				success: false,
				message: "Некорректное количество записей",
			});
		}

		const account = await Account.findOne({
			where: { token },
			attributes: ["id"],
			raw: true,
		});

		if (!account) {
			return res.status(401).json({
				success: false,
				message: "Требуется авторизация",
			});
		}

		const user = await UserInfo.findOne({
			where: { id_acc: account.id },
			attributes: ["id"],
			raw: true,
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "Профиль не найден",
			});
		}

		const whereClause = { id_user: user.id };

		if (type_operation) {
			whereClause.type_transaction = type_operation;
		}

		const { count, rows: operations } =
			await HistoryOperation.findAndCountAll({
				where: whereClause,
				order: [
					["date", "DESC"],
					["time", "DESC"],
				],
				offset: (parsedPage - 1) * parsedLimit,
				limit: parsedLimit,
				include: [
					{
						model: TypeTransaction,
						as: "transaction_type",
						attributes: ["naim"],
						required: false,
					},
				],
				attributes: [
					"id",
					"change",
					"is_succesfull",
					"date",
					"time",
					"type_transaction",
				],
			});

		const formattedOperations = operations.map((op) => ({
			id: op.id,
			amount: op.change,
			is_successful: op.is_succesfull,
			date: op.date,
			time: op.time,
			operation_type: op.type_transaction,
			operation_name: op.transaction_type?.naim || "Неизвестная операция",
		}));

		res.json({
			success: true,
			data: formattedOperations,
			pagination: {
				current_page: parsedPage,
				total_pages: Math.ceil(count / parsedLimit),
				total_operations: count,
				per_page: parsedLimit,
			},
		});
	} catch (error) {
		console.error(
			`[${new Date().toISOString()}] History Operation Error:`,
			error
		);
		res.status(500).json({
			success: false,
			message: "Ошибка при получении истории операций",
			error:
				process.env.NODE_ENV === "development"
					? error.message
					: undefined,
		});
	}
});

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

function canPlaceNumber(grid, row, col, num) {
	for (let x = 0; x < 9; x++) {
		if (grid[row][x] === num) return false; // Проверка строки
	}
	for (let x = 0; x < 9; x++) {
		if (grid[x][col] === num) return false; // Проверка столбца
	}
	const startRow = Math.floor(row / 3) * 3;
	const startCol = Math.floor(col / 3) * 3;
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			if (grid[startRow + i][startCol + j] === num) return false; // Проверка 3x3 блока
		}
	}
	return true;
}

function fillDiagonalBlocks(grid) {
	for (let block = 0; block < 3; block++) {
		const startRow = block * 3;
		const startCol = block * 3;
		const numbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		let numIndex = 0;
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				grid[startRow + i][startCol + j] = numbers[numIndex++];
			}
		}
	}
}

function solveGrid(grid, row = 0, col = 0) {
	if (row === 9) return true;
	if (col === 9) return solveGrid(grid, row + 1, 0);
	if (grid[row][col] !== 0) return solveGrid(grid, row, col + 1);

	const numbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	for (const num of numbers) {
		if (canPlaceNumber(grid, row, col, num)) {
			grid[row][col] = num;
			if (solveGrid(grid, row, col + 1)) return true;
			grid[row][col] = 0;
		}
	}
	return false;
}

function generateFullGrid() {
	const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
	fillDiagonalBlocks(grid);
	solveGrid(grid);
	return grid;
}

function removeRandomCells(grid, cellsToRemove) {
	const positions = [];
	for (let r = 0; r < 9; r++) {
		for (let c = 0; c < 9; c++) {
			positions.push([r, c]);
		}
	}
	shuffle(positions);
	for (let i = 0; i < cellsToRemove; i++) {
		const [row, col] = positions[i];
		grid[row][col] = 0;
	}
}

function calculateCompletionProbability(grid, cells) {
	let emptyCells = 0;
	const usedNumbers = new Set();

	for (const [r, c] of cells) {
		if (grid[r][c] === 0) {
			emptyCells++;
		} else {
			usedNumbers.add(grid[r][c]);
		}
	}

	if (emptyCells === 0) return 100;

	let totalCombinations = 1;
	const availableNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(
		(num) => !usedNumbers.has(num)
	);
	for (let i = 0; i < emptyCells; i++) {
		totalCombinations *= availableNumbers.length - i;
	}

	const baseProbability = (availableNumbers.length / emptyCells) * 100;
	return Math.min(
		100,
		Math.max(0, Math.round(baseProbability / (emptyCells + 1)))
	);
}

function checkCompletions(grid, setting) {
	let payout = 0;

	for (let r = 0; r < 9; r++) {
		if (grid[r].every((cell) => cell !== 0)) {
			payout += setting.payout_row_col;
		}
	}

	for (let c = 0; c < 9; c++) {
		const column = Array.from({ length: 9 }, (_, r) => grid[r][c]);
		if (column.every((cell) => cell !== 0)) {
			payout += setting.payout_row_col;
		}
	}

	for (let br = 0; br < 3; br++) {
		for (let bc = 0; bc < 3; bc++) {
			const block = [];
			for (let r = br * 3; r < br * 3 + 3; r++) {
				for (let c = bc * 3; c < bc * 3 + 3; c++) {
					block.push(grid[r][c]);
				}
			}
			if (block.every((cell) => cell !== 0)) {
				payout += setting.payout_block;
			}
		}
	}

	if (grid.every((row) => row.every((cell) => cell !== 0))) {
		payout += setting.payout_complete;
	}

	return payout;
}

app.post("/game/start", isUser, async (req, res) => {
	const { id_setting_game } = req.body;
	const token = req.headers.authorization.replace("Bearer ", "");
	const transaction = await sequelize.transaction();

	try {
		const account = await Account.findOne({ where: { token } });
		if (!account) {
			await transaction.rollback();
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
		});
		if (!userInfo) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		const activeGame = await Game.findOne({
			where: { id_user: userInfo.id, is_active: true },
			transaction,
		});
		if (activeGame) {
			await transaction.rollback();
			return res
				.status(400)
				.json({ message: "У вас уже есть активная игра" });
		}

		const setting = await SettingGame.findOne({
			where: { id: id_setting_game, is_active: true },
			transaction,
		});
		if (!setting) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Настройка игры не найдена или неактивна" });
		}

		const grid = generateFullGrid();
		removeRandomCells(grid, setting.initial_filled_cells);
		const currentNumber = await generateRandomNumber(1, 9);

		const game = await Game.create(
			{
				id_user: userInfo.id,
				grid,
				current_number: currentNumber,
				skip_count: 0,
				current_move_cost: setting.base_move_cost,
				total_bets: 0,
				total_payouts: 0,
				is_active: true,
				date_created: new Date().toISOString().split("T")[0],
				time_created: new Date().toTimeString().split(" ")[0],
				id_setting_game: setting.id,
			},
			{ transaction }
		);

		await transaction.commit();

		res.status(201).json({
			success: true,
			game: {
				id: game.id,
				grid: game.grid,
				current_number: game.current_number,
				skip_count: game.skip_count,
				current_move_cost: parseFloat(game.current_move_cost),
				total_bets: parseFloat(game.total_bets),
				total_payouts: parseFloat(game.total_payouts),
				is_active: game.is_active,
				date_created: game.date_created,
				time_created: game.time_created,
				setting: {
					base_move_cost: parseFloat(setting.base_move_cost),
					initial_skill_cost: parseFloat(setting.initial_skill_cost),
					payout_row_col: parseFloat(setting.payout_row_col),
					payout_block: parseFloat(setting.payout_block),
					payout_complete: parseFloat(setting.payout_complete),
					initial_filled_cells: setting.initial_filled_cells,
				},
			},
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при создании игры:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.post("/game/move", isUser, async (req, res) => {
	const { game_id, cells } = req.body; // cells: { row: number, col: number }
	const token = req.headers.authorization.replace("Bearer ", "");
	const transaction = await sequelize.transaction();
	try {
		const account = await Account.findOne({ where: { token } });
		if (!account) {
			await transaction.rollback();
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
		});
		if (!userInfo) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		const game = await Game.findOne({
			where: { id: game_id, id_user: userInfo.id, is_active: true },
			include: [{ model: SettingGame, as: "setting" }],
			transaction,
		});
		if (!game) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Игра не найдена или неактивна" });
		}

		const { row, col } = cells;
		if (game.grid[row][col] !== 0) {
			await transaction.rollback();
			return res.status(400).json({ message: "Клетка уже заполнена" });
		}

		// Проверка допустимости числа
		if (!canPlaceNumber(game.grid, row, col, game.current_number)) {
			await transaction.rollback();
			return res.status(400).json({
				message: "Нельзя поставить это число сюда",
				invalid_cells: checkInvalidCells(
					game.grid,
					row,
					col,
					game.current_number
				),
			});
		}

		// Проверка баланса
		const cost =
			parseFloat(game.current_move_cost) +
			game.skip_count * parseFloat(game.setting.initial_skill_cost);
		if (userInfo.bonus_balance < cost) {
			await transaction.rollback();
			return res.status(400).json({ message: "Недостаточно бонусов" });
		}

		// Обновление сетки
		game.grid[row][col] = game.current_number;

		// Обновление баланса и ставок
		userInfo.bonus_balance -= cost;
		game.total_bets = parseFloat(game.total_bets) + cost;
		game.skip_count = 0;
		game.current_move_cost = parseFloat(game.setting.base_move_cost);

		// Проверка завершений
		const { payout, updatedGrid } = checkCompletions(
			game.grid,
			game.setting
		);
		game.grid = updatedGrid;
		game.total_payouts = parseFloat(game.total_payouts) + payout;
		userInfo.bonus_balance += payout;

		// Генерация нового числа
		game.current_number = await generateRandomNumber(1, 9);

		// Проверка на завершение игры
		const isComplete = game.grid.every((row) =>
			row.every((cell) => cell !== 0)
		);
		if (isComplete) {
			game.is_active = false;
		}

		// Сохранение изменений
		await userInfo.save({ transaction });
		await game.save({ transaction });
		await transaction.commit();

		res.status(200).json({
			success: true,
			game: {
				id: game.id,
				grid: game.grid,
				current_number: game.current_number,
				skip_count: game.skip_count,
				current_move_cost: parseFloat(game.current_move_cost),
				total_bets: parseFloat(game.total_bets),
				total_payouts: parseFloat(game.total_payouts),
				is_active: game.is_active,
				date_created: game.date_created,
				time_created: game.time_created,
				bonus_balance: userInfo.bonus_balance,
				real_balance: userInfo.real_balance || 10.0,
			},
			payout,
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при выполнении хода:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

// Вспомогательные функции
function canPlaceNumber(grid, row, col, num) {
	for (let c = 0; c < 9; c++) {
		if (grid[row][c] === num) return false;
	}
	for (let r = 0; r < 9; r++) {
		if (grid[r][col] === num) return false;
	}
	const blockRow = Math.floor(row / 3) * 3;
	const blockCol = Math.floor(col / 3) * 3;
	for (let r = blockRow; r < blockRow + 3; r++) {
		for (let c = blockCol; c < blockCol + 3; c++) {
			if (grid[r][c] === num) return false;
		}
	}
	return true;
}

function checkInvalidCells(grid, row, col, num) {
	const invalid = [];
	for (let c = 0; c < 9; c++) {
		if (c !== col && grid[row][c] === num) {
			invalid.push(`${row}-${c}`);
		}
	}
	for (let r = 0; r < 9; r++) {
		if (r !== row && grid[r][col] === num) {
			invalid.push(`${r}-${col}`);
		}
	}
	const blockRow = Math.floor(row / 3) * 3;
	const blockCol = Math.floor(col / 3) * 3;
	for (let r = blockRow; r < blockRow + 3; r++) {
		for (let c = blockCol; c < blockCol + 3; c++) {
			if ((r !== row || c !== col) && grid[r][c] === num) {
				invalid.push(`${r}-${c}`);
			}
		}
	}
	return invalid;
}

function checkCompletions(grid, setting) {
	let payout = 0;
	const newGrid = grid.map((row) => row.slice());
	const isCompleteGroup = (cells) => {
		const seen = new Set();
		for (const [r, c] of cells) {
			const val = newGrid[r][c];
			if (val === 0 || seen.has(val)) return false;
			seen.add(val);
		}
		return true;
	};

	// Проверка строк
	for (let r = 0; r < 9; r++) {
		const cells = Array.from({ length: 9 }, (_, c) => [r, c]);
		if (isCompleteGroup(cells)) {
			payout += parseFloat(setting.payout_row_col);
			cells.forEach(([r, c]) => (newGrid[r][c] = 0));
		}
	}

	// Проверка столбцов
	for (let c = 0; c < 9; c++) {
		const cells = Array.from({ length: 9 }, (_, r) => [r, c]);
		if (isCompleteGroup(cells)) {
			payout += parseFloat(setting.payout_row_col);
			cells.forEach(([r, c]) => (newGrid[r][c] = 0));
		}
	}

	// Проверка блоков
	for (let br = 0; br < 3; br++) {
		for (let bc = 0; bc < 3; bc++) {
			const cells = [];
			for (let r = br * 3; r < br * 3 + 3; r++) {
				for (let c = bc * 3; c < bc * 3 + 3; c++) {
					cells.push([r, c]);
				}
			}
			if (isCompleteGroup(cells)) {
				payout += parseFloat(setting.payout_block);
				cells.forEach(([r, c]) => (newGrid[r][c] = 0));
			}
		}
	}

	// Проверка полного завершения
	const isComplete = newGrid.every((row) => row.every((cell) => cell !== 0));
	if (isComplete) {
		payout += parseFloat(setting.payout_complete);
	}

	return { payout, updatedGrid: newGrid };
}

app.post("/game/skip", isUser, async (req, res) => {
	const { game_id } = req.body;
	const token = req.headers.authorization.replace("Bearer ", "");
	const transaction = await sequelize.transaction();

	try {
		const account = await Account.findOne({ where: { token } });
		if (!account) {
			await transaction.rollback();
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
			transaction,
		});
		if (!userInfo) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		const game = await Game.findOne({
			where: { id: game_id, id_user: userInfo.id, is_active: true },
			include: [{ model: SettingGame, as: "setting" }],
			transaction,
		});
		if (!game) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Игра не найдена или не активна" });
		}

		const setting = game.setting;
		const skipCost = parseFloat(
			setting.initial_skill_cost?.replace("$", "").replace(/,/g, "") ||
				"0"
		);
		const userBalance =
			parseFloat(userInfo.balance_virtual)
				?.replace("$", "")
				.replace(/,/g, "") || "0";

		if (userBalance < skipCost) {
			await transaction.rollback();
			return res
				.status(400)
				.json({ message: "Недостаточно средств для пропуска" });
		}

		userInfo.balance_virtual = (userBalance - skipCost).toFixed(2);
		game.skip_count += 1;
		game.total_bets = (parseFloat(game.total_bets) + skipCost).toFixed(2);

		const newNumber = await generateRandomNumber(1, 9);
		game.current_number = newNumber;

		const typeTransaction = await TypeTransaction.findOne({
			where: { naim: "Пропуск хода в судоку (бонусы)" },
			transaction,
		});
		if (!typeTransaction) {
			await transaction.rollback();
			throw new Error(
				"Тип транзакции 'Пропуск хода в судоку (бонусы)' не найден"
			);
		}

		const currentDate = new Date();
		await HistoryOperation.create(
			{
				id_user: userInfo.id,
				change: (-skipCost).toFixed(2),
				date: currentDate.toISOString().split("T")[0],
				time: currentDate.toTimeString().split(" ")[0],
				type_transaction: typeTransaction.id,
				is_succesfull: true,
			},
			{ transaction }
		);

		await userInfo.save({ transaction });
		await game.save({ transaction });

		await transaction.commit();

		res.status(200).json({
			success: true,
			game: {
				id: game.id,
				grid: game.grid,
				current_number: game.current_number,
				skip_count: game.skip_count,
				current_move_cost: parseFloat(game.current_move_cost),
				total_bets: parseFloat(game.total_bets),
				total_payouts: parseFloat(game.total_payouts),
				is_active: game.is_active,
				date_created: game.date_created,
				time_created: game.time_created,
			},
			new_balance: parseFloat(userInfo.balance_real),
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при пропуске хода:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.post("/game/end", isUser, async (req, res) => {
	const { game_id } = req.body;
	const token = req.headers.authorization.replace("Bearer ", "");
	const transaction = await sequelize.transaction();

	try {
		const account = await Account.findOne({ where: { token } });
		if (!account) {
			await transaction.rollback();
			return res.status(401).json({ message: "Пользователь не найден" });
		}

		const userInfo = await UserInfo.findOne({
			where: { id_acc: account.id },
			transaction,
		});
		if (!userInfo) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Информация о пользователе не найдена" });
		}

		const game = await Game.findOne({
			where: { id: game_id, id_user: userInfo.id, is_active: true },
			transaction,
		});
		if (!game) {
			await transaction.rollback();
			return res
				.status(404)
				.json({ message: "Игра не найдена или не активна" });
		}

		game.is_active = false;
		await game.save({ transaction });

		await transaction.commit();

		res.status(200).json({
			success: true,
			message: "Игра завершена",
			game: {
				id: game.id,
				is_active: game.is_active,
				total_bets: parseFloat(game.total_bets),
				total_payouts: parseFloat(game.total_payouts),
			},
		});
	} catch (error) {
		await transaction.rollback();
		console.error("Ошибка при завершении игры:", error);
		res.status(500).json({
			success: false,
			message: "Ошибка сервера: " + error.message,
		});
	}
});

app.listen(port, async () => {
	try {
		await connectToDatabase();
		console.log(`Сервер запущен на порту ${port}`);
		// await updateSettingsCache();
	} catch (error) {
		console.error("Ошибка при запуске сервера:", error);
	}
});

process.on("SIGINT", async () => {
	console.log("Завершение работы сервера...");
	for (const settingId of Object.keys(intervalJobs)) {
		if (intervalJobs[settingId]) {
			clearInterval(intervalJobs[settingId]);
			console.log(`Остановлен таймер для настройки ${settingId}`);
		}
	}
	await disconnectFromDatabase();
	process.exit(0);
});
