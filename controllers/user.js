const User = require('../models/user')
const Book = require('../models/book')
const mailer = require('../utils/mailer')
const mailConfig = require('../config/mail')
const ldap = require('../utils/ldap')

exports.register = async ctx=>{
    const name = ctx.request.body.name;
    let user = await User.findOne({ name }).exec();

    if(user){
        ctx.body = {code:200,msg:'该邮箱已被注册！'}
    }else{
        user = new User(ctx.request.body);
        const newUser = await user.save();
        if(newUser){
            delete ctx.session.pin
            delete newUser.password
            ctx.session.user = JSON.parse(JSON.stringify(newUser))
            ctx.body = {code:0,data: ctx.session.user}
        }
    }
}

exports.getUser = async ctx=>{
    if(ctx.session.user){
        let user = await User.findById(ctx.session.user._id);
        delete user.password
        ctx.session.user = JSON.parse(JSON.stringify(user))
        ctx.body = {code:0,data: ctx.session.user}
    }else{
        ctx.body = {code:205,msg: '您尚未登录！'}
    }
}

exports.ldapLogin = async ctx=>{
    try {
        const { name, password } = ctx.request.body;
        const isValid = await ldap.ldapQuery(name, password);
        console.log('isVaild', isValid);

        let user = await User.findOne({name});

        if (!user || !user._id) {
            user = new User({
                name,
                password,
            });
            user = await user.save();
        }
        delete user.password
        ctx.session.user = JSON.parse(JSON.stringify(user))
        ctx.body = {code:0,data: ctx.session.user}
    } catch (e) {
        return ctx.body = {code: 401, msg: e.message};
    }
}

//login
exports.login = async ctx=>{
    const name = ctx.request.body.name
    const password = ctx.request.body.password
    const user = await User.findOne({name}).exec()

    if(user){
        const isMatch = await user.comparePassword(password)
        if(isMatch){
            delete user.password
            ctx.session.user = JSON.parse(JSON.stringify(user))
            ctx.body = {code:0,data: ctx.session.user}
        }else{
            ctx.body = {code:202,msg:'用户名或密码错误！'}
        }
    }else{
        ctx.body = {code:201,msg:'用户名或密码错误！'}
    }
}

//logout
exports.logout =  async ctx=>{
    delete ctx.session.user
    ctx.body = {code:0,data: true}
}

exports.getPin = async ctx=>{
    if(ctx.session.pin) return ctx.body = {code: 203,msg: '不要频繁获取验证码！'};

    const name = ctx.request.body.name;
    const user = await User.findOne({name}).exec();

    //checkUser为true代表user必须存在才能发邮件（用在修改密码），false表示user不存在才能发邮件（用在注册）
    if(ctx.request.body.checkUser && !user){
        ctx.body = {code: 204, msg: '该用户不存在！'};
    }else if(!ctx.request.body.checkUser && user){
        ctx.body = {code: 204, msg: '该邮箱已被注册！'};
    }else{
        //生成一个5位的包含数字、字母的随机字符串
        const rs = Math.random().toString(36).slice(2,7).toUpperCase();

        // setup e-mail data with unicode symbols
        const mailOptions = {
            from: mailConfig.auth.user, // sender address
            to: name, // list of receivers
            subject: 'G7读书验证码', // Subject line
            text: `这是您的邮箱注册验证码${rs}，请在两分钟内使用哦`, // plaintext body
            html: '' // html body
        };

        // send mail with required mailer object
        try{
            await mailer.sendMail(mailOptions);

            ctx.session.pin = {
                code: rs,
                email: name
            };
            ctx.body = {code: 0,data: true};
        }catch(e){
            console.log(e)
            ctx.body = {code: 204, msg: '验证邮件发送失败！'};
        }
    }
}

exports.borrow = async ctx=>{
    const user = await User.findById(ctx.session.user._id);

    if(user.borrowedBooks.length > 2){
        ctx.body = {code: 206, msg: '最多只能同时借三本书哦！'};
    }else if(user.borrowedBooks.some((book)=> book.id == ctx.request.body.id)){
        ctx.body = {code: 204, msg: '您已经借过相同的书了！'};
    }else{
        const book = await Book.findById(ctx.request.body.id);
        //找到一本未借出的书
        const identifier = book.identifierList.find((identifier) => {
            let notBorrowed = true;
            for(const borrower of book.borrowers){
                if(borrower.identifier === identifier){
                    notBorrowed = false;
                    break;
                }
            }
            return notBorrowed;
        })
        if (identifier !== undefined) {
            book.borrowers.push({name: user.name, identifier});
    
            user.borrowedBooks.push({id: ctx.request.body.id, identifier});
            user.notHashPassword = true; 
            await Promise.all([book.save(), user.save()]);
            ctx.body = {code: 0, data: identifier};
        } else {
            ctx.body = {code: 207, msg: '该书已被借完！'};
        }
    }
}

exports.return = async ctx=>{
    let user = await User.findById(ctx.session.user._id);
    const i = user.borrowedBooks.findIndex((book)=> book.id == ctx.request.body.id);

    if(i != -1){
        let book = await Book.findById(ctx.request.body.id);
        const j = book.borrowers.findIndex((_user)=> _user.name == user.name);
        book.borrowers.splice(j,1);

        user.borrowedBooks.splice(i,1);
        user.notHashPassword = true;
        await Promise.all([book.save(), user.save()]);
        ctx.body = {code: 0, data: true};
    }else{
        ctx.body = {code: 204, msg: '你没有借该书！'}; 
    }
}

exports.resetPassword = async ctx=>{
    let user = await User.findOne({name: ctx.request.body.name}).exec();

    if(user){
        user.password = ctx.request.body.password;
        await user.save();
        delete ctx.session.pin;
        ctx.body = {code:0,data: true};
    }else{
        ctx.body = {code:200,msg:'该用户不存在！'};
    }
}