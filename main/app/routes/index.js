const express = require('express');
const path = require('path');
const router = express.Router();
module.exports = router;

const session = require('express-session');
const passport = require('passport');
require('../passport-setup');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const client = require('../models/client');
const { time } = require('console');
const salt = 'pAssW0rd_';

router.get('/getRoli', async (req, res) => {
    try {
        const result = await client.query('SELECT id, naim FROM public.role;');
        res.status(200).header({'Content-Type': 'application/json'}).send(result);
        console.log(result);
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка');
    }
})

router.post('/register', async (req, res) => {
    const token = req.body.jwt;
    const encryptedData = req.body.data;
    const fio = res.body.fio;
    const id_okna = res.body.id_okna;
    const login = res.body.login;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const decryptedData = decryptData(encryptedData, salt);

            const result = await client.query('SELECT id FROM public.role WHERE id = (SELECT id_roli FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);
            const id_otdelenia = await client.query('SELECT id_otelenia FROM public.okna WHERE id = (SELECT id_okna FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);

            if (result < 3) { // Пользователь не явяляется оператором
                const randomPassword = Math.random().toString(36).slice(-8);

                const id = await client.query('INSERT INTO public.(id_otdelenia, password) VALUES ($1, $2) RETURNING id;', [id_otdelenia, randomPassword]);
                
                const data = {
                    login: id,
                    password: randomPassword
                };

                const tokenTerminal = jwt.sign(data, salt);
                res.status(200).send(tokenTerminal);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
});

router.get('/login', async (req, res) => {
    const login = req.body.login;
    const encryptedData = req.body.data;

    try {
        const decryptedData = decryptData(encryptedData, salt);
        const result = await client.query('SELECT COUNT(*) FROM public.sotr WHERE login = $1 AND password = $2;', [login, decryptedData.password]);
        
        if (result != undefined)
        {
            const options = {
                expiresIn: '1d'        // Время жизни токена
            };

            const token = jwt.sign(decryptedData, salt, options);

            res.status(200).send(token);
        }
    } catch (error) {
        console.error('Ошибка расшифровки:', error);
        res.status(400).json({ error: 'Ошибка расшифровки данных' });
    }
});

router.post('/addTelegramAccount', async (req, res) => {
    const fio = res.fio;
    const username = res.username;

    try {
        const result = await client.query('SELECT COUNT(*) FROM public.telegram_acc WHERE usermane = $1;', [username]);
        if (result == 0) {
            result =  await client.query('INSERT INTO public.telegram_acc(fio, usermane) VALUES ($1, $2);', [fio, username]);
            res.status(201).send('Успешная регистрация');
        }
        else {
            res.status(302).send('Такой пользователь уже был зарегестирован в системе');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при регистрации');
    }
});

router.get('/loginTerminal', async (req, res) => {
    const encryptedData = req.body.data;

    try {
        const decryptedData = decryptData(encryptedData, salt);
        console.log('Расшифрованные данные:', decryptedData);

        const result = await client.query('SELECT COUNT(*) FROM public.terminal WHERE id = $1 AND password = $2;', [decryptedData.id, decryptedData.password]);
        
        if (result != undefined)
        {
            const options = {
                expiresIn: '365d'        // Время жизни токена
            };

            const token = jwt.sign(decryptedData, salt, options);

            res.status(200).send(token);
        }
    
    } catch (error) {
        console.error('Ошибка расшифровки:', error);
        res.status(400).json({ error: 'Ошибка расшифровки данных' });
    }
});

router.post('/addTerminal', async (req, res) => {
    const token = req.body.jwt;
    const encryptedData = req.body.data;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const decryptedData = decryptData(encryptedData, salt);

            const result = await client.query('SELECT id FROM public.role WHERE id = (SELECT id_roli FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);
            const id_otdelenia = await client.query('SELECT id_otelenia FROM public.okna WHERE id = (SELECT id_okna FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);

            if (result < 3) { // Пользователь не явяляется оператором
                const randomPassword = Math.random().toString(36).slice(-8);

                const id = await client.query('INSERT INTO public.terminal(id_otdelenia, password) VALUES ($1, $2) RETURNING id;', [id_otdelenia, randomPassword]);
                
                const data = {
                    login: id,
                    password: randomPassword
                };

                const tokenTerminal = jwt.sign(data, salt);
                res.status(200).send(tokenTerminal);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
})

router.post('/addOtdelenie', async (req, res) => {
    const token = req.body.jwt;
    const encryptedData = req.body.data;
    const adres = req.body.adres;
    const naimenovanie = req.body.naimenovanie;
    const ecs = req.body.ecs;
    const index = req.body.index;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const decryptedData = decryptData(encryptedData, salt);
            const result = await client.query('SELECT id FROM public.role WHERE id = (SELECT id_roli FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);

            if (result == 1) { // Пользователь явяляется администратором
                const id = await client.query('INSERT INTO public.otdelenia(adres, naimenovanie, ecs, index) VALUES ($1, $2, $3, $4) RETURNING id;', [adres, naimenovanie, ecs, index]);
                res.status(200).send(id);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
});

router.post('/addGrafik', async (req, res) => {
    const token = req.body.jwt;
    const encryptedData = req.body.data;
    const id_otdelenia = req.body.id_otdelenia;
    const den_nedeli = req.body.den_nedeli;
    const pereryv_start = req.body.pereryv_start;
    const pereryv_stop = req.body.pereryv_stop;
    const start = req.body.start; 
    const stop = req.body.stop;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const decryptedData = decryptData(encryptedData, salt);
            const result = await client.query('SELECT id FROM public.role WHERE id = (SELECT id_roli FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);

            if (result < 3) { // Пользователь явяляется администратором или руководителем отделения
                const id = await client.query('INSERT INTO public.grafik(id_otdelenia, den_nedeli, pereryv_start, pereryv_stop, start, stop) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;', [id_otdelenia, den_nedeli, pereryv_start, pereryv_stop, start, stop]);
                res.status(200).send(id);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
});

router.get('/spisokUslug', async (req, res) => {
    const id_otdelenia = res.id_otdelenia;

    try {
        const spisokUslug = await client.query('SELECT public.uslugi.naim FROM uslugi LEFT JOIN (SELECT id_uslugi FROM (SELECT * FROM okna WHERE id_otelenia = $1) LEFT JOIN public.uslugi_okna ON public.okna.id = public.uslugi_okna.id_okna)) ON public.uslugi_okna.id_uslugi = public.uslugi.id', [id_otdelenia]);
        if (result.rows[0].count != 0) {
            res.status(201).send(spisokUslug);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при удалении');
    }
});

router.post('/addUsluga', async (req, res) => {
    const naim = res.naim;
    const shifr = res.shifr;

    try {
        const result = await client.query('SELECT COUNT(*) FROM public.uslugi WHERE naim = $1;', [naim]);

        if (result.rows[0].count == 0) {
            const id = await client.query('INSERT INTO public.uslugi(naim, shifr) VALUES ($1, $2) RETURNING id;', [naim, shifr]);
            res.status(201).send('Успешное добавление');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при добавлении');
    }
});

router.post('/delUsluga', async (req, res) => {
    const naim = res.naim;
    const shifr = res.shifr;

    try {
        const result = await client.query('DELETE FROM public.uslugi WHERE naim = $1 AND shifr = $2;', [naim, shifr]);

        if (result.rows[0].count != 0) {
            res.status(201).send('Успешное удаление');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка при удалении');
    }
});

router.post('/addOkno', async (req, res) => {
    const token = req.body.jwt;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const sotr = res.body.okno;
    
            try {
                const result = await client.query('INSERT INTO public.okna(id_otelenia, naim_okna, time_obrabotki) VALUES ($1, $2, $3);', [sotr.id_otdelenia, sotr.naim_okna, sotr.time_obrabotki]);
            
                if (result.rows[0].count != 0) {
                    res.status(201).send('Успешное добавление');
                }
            } catch (error) {
                console.error(error);
                res.status(500).send('Ошибка при добавлении');
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
});

router.post('/addSotr', async (req, res) => {
    const token = req.body.jwt;
    const encryptedData = req.body.data;

    try {
        const decoded = jwt.verify(token, salt);
        
        if (decoded != undefined) {
            const decryptedData = decryptData(encryptedData, salt);

            const result = await client.query('SELECT id FROM public.role WHERE id = (SELECT id_roli FROM public.sotr WHERE login = $1, password = $2);', [decryptedData.login, decryptedData.password]);

            if (result > 1) { // Пользователь не явяляется оператором
                const result = await client.query('INSERT INTO public.sotr(login, password, id_roli, fio, id_okna) VALUES ($1, $2, $3, $4, %5) RETURNING id;', [decryptedData.login, decryptedData.passport, decryptedData.fio, decryptedData.id_okna]);
                
                res.status(200).send(result);
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке токена:', error.message);
    }
});

router.get('/getTalons', async (req, res) => {
    const isTerminal = res.body.isTerminal;
    const dayOfWeek = res.body.dayOfWeek;
    const usluga = res.body.usluga;

    if (dayOfWeek == undefined)
    {
        let date = new Date();
        dayOfWeek = [7, 1, 2, 3, 4, 5, 6][date.getDay()];
    }

    if (isTerminal) {
        try {
            const decoded = jwt.verify(res.body.token, salt);
            
            if (decoded != undefined) {
                const result = decryptData(encryptedData, salt);
    
                const id_otdelenia = await client.query('SELECT id_otdelenia FROM public.terminal WHERE id = $1 AND password = $2;', [result.id, result.password]);

                const grafikRabot = await client.query('SELECT start, stop FROM public.grafik WHERE id_otdelenia = $1 AND den_nedeli = $2;', [id_otdelenia.id_otdelenia, dayOfWeek]);

                if (id_otdelenia != undefined) {
                    const okna = await client.query('SELECT id, naim_okna FROM public.okna WHERE id_otelenia = $1 AND talony_telegram = false;', [id_otdelenia]);
                    
                    var talony = [];

                    okna.forEach(async element => {
                        const talonyOkna = await client.query('SELECT naim FROM (SELECT * FROM (SELECT * FROM public.uslugi_okna WHERE id_okna = $1 AND id_uslugi = $2) LEFT JOIN public.uslugi WHERE public.uslugi_okna.id_uslugi = public.uslugi.id) WHERE public.uslugi.time_start < CURRENT_TIME AND public.uslugi.time_stop > CURRENT_TIME AND NOW() > $3 AND NOW() < $4);', [element.id_okna, usluga, grafikRabot.start, grafikRabot.stop]);
                        talony.push([naim_okna = element.naim_okna, id = element.id, talonyOkna = talonyOkna]);
                    });
                    
                    res.status(200).send(talony);
                }
            }
        } catch (error) {
            console.error('Ошибка при проверке токена:', error.message);
        }
    } else {
        try {
            const decoded = jwt.verify(res.body.token, salt);
            
            if (decoded != undefined) {
                const decryptedData = decryptData(encryptedData, salt);
    
                const result = await client.query('SELECT id_otdelenia FROM public.sotr WHERE login = $1 AND password = $2;', [decryptedData.login, decryptedData.password]);

                const grafikRabot = await client.query('SELECT start, stop FROM public.grafik WHERE id_otdelenia = $1 AND den_nedeli = $2;', [result.id_otdelenia, dayOfWeek]);

                if (result != undefined) {
                    const okna = await client.query('SELECT id, naim_okna FROM public.okna WHERE id_otelenia = $1 AND talony_telegram = true;', [result]);
                    
                    var talony = [];

                    const result = await client.query('SELECT id_otdelenia FROM public.sotr WHERE login = $1 AND password = $2;', [decryptedData.login, decryptedData.password]);

                    okna.forEach(async element => {
                        const talonyOkna = await client.query('SELECT naim FROM (SELECT * FROM (SELECT * FROM public.uslugi_okna WHERE id_okna = $1 AND id_uslugi = $2) LEFT JOIN public.uslugi WHERE public.uslugi_okna.id_uslugi = public.uslugi.id) WHERE public.uslugi.time_start < CURRENT_TIME AND public.uslugi.time_stop > CURRENT_TIME AND NOW() > $3 AND NOW() < $4);', [element.id_okna, usluga, grafikRabot.start, grafikRabot.stop]);
                        talony.push([naim_okna = element.naim_okna, id = element.id, talonyOkna = talonyOkna]);
                    });
                    
                    res.status(200).send(talony);
                }
            }
        } catch (error) {
            console.error('Ошибка при проверке токена:', error.message);
        }
    }
});

router.post('/addTalon', async (req, res) => {
    const isTerminal = res.body.isTerminal;
    const dayOfWeek = res.body.dayOfWeek;
    const date = res.body.date;
    const time = res.body.time;
    const usluga = res.body.usluga;
    const id_okna = res.body.id_okna;
    const id_uslugi = res.body.id_uslugi;
    const nom_talona = res.body.nom_talona;

    if (date == undefined)
    {
        data = new Date();
    }

    if (dayOfWeek == undefined)
    {
        let date = new Date();
        dayOfWeek = [7, 1, 2, 3, 4, 5, 6][date.getDay()];
    }

    if (isTerminal) {
        try {
                const id_otdelenia = await client.query('SELECT id_otdelenia FROM public.okna WHERE id = $1;', [id_okna]);
                const grafikRabot = await client.query('SELECT start, stop FROM public.grafik WHERE id_otdelenia = $1 AND den_nedeli = $2;', [id_otdelenia.id_otdelenia, dayOfWeek]);

                if (id_otdelenia != undefined) {
                    const okna = await client.query('SELECT id, naim_okna FROM public.okna WHERE id_otelenia = $1 AND talony_telegram = false;', [id_otdelenia]);

                    const estTalon = await client.query('SELECT COUNT(*) FROM (SELECT * FROM (SELECT * FROM public.uslugi_okna WHERE id_okna = $1 AND id_uslugi = $2) LEFT JOIN public.uslugi WHERE public.uslugi_okna.id_uslugi = public.uslugi.id) WHERE public.uslugi.time_start < CURRENT_TIME AND public.uslugi.time_stop > CURRENT_TIME AND NOW() > $3 AND NOW() < $4);', [id_okna, usluga, grafikRabot.start, grafikRabot.stop]);
                    
                    if (estTalon == 0)
                    {
                        await client.query('INSERT INTO public.talony(id_okna, date, "time", nom_talona, id_uslugi) VALUES ($1, $2, $3, $4, $5);', [id_okna, date, time, nom_talona, id_uslugi]);
                        res.status(200).send(talony);
                    }
                    else
                        res.status(400).send('Такой талон нельзя добавить');
                }
        } catch (error) {
            console.error('Ошибка при проверке токена:', error.message);
        }
    } else {
        try {
            const decryptedData = decryptData(encryptedData, salt);
    
                const result = await client.query('SELECT id_otdelenia FROM public.sotr WHERE login = $1 AND password = $2;', [decryptedData.login, decryptedData.password]);

                const grafikRabot = await client.query('SELECT start, stop FROM public.grafik WHERE id_otdelenia = $1 AND den_nedeli = $2;', [result.id_otdelenia, dayOfWeek]);

                if (result != undefined) {
                    const okna = await client.query('SELECT id, naim_okna FROM public.okna WHERE id_otelenia = $1 AND talony_telegram = true;', [id_otdelenia]);
                    const estTalon = await client.query('SELECT COUNT(*) FROM (SELECT * FROM (SELECT * FROM public.uslugi_okna WHERE id_okna = $1 AND id_uslugi = $2) LEFT JOIN public.uslugi WHERE public.uslugi_okna.id_uslugi = public.uslugi.id) WHERE public.uslugi.time_start < CURRENT_TIME AND public.uslugi.time_stop > CURRENT_TIME AND NOW() > $3 AND NOW() < $4);', [id_okna, usluga, grafikRabot.start, grafikRabot.stop]);
                    
                    if (estTalon == 0)
                    {
                        await client.query('INSERT INTO public.talony(id_okna, date, "time", nom_talona, id_uslugi) VALUES ($1, $2, $3, $4, $5);', [id_okna, date, time, , id_uslugi]);
                        res.status(200).send(talony);
                    }
                    else
                        res.status(400).send('Такой талон нельзя добавить');
                }
        } catch (error) {
            console.error('Ошибка при проверке токена:', error.message);
        }
    }
});