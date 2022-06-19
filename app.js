//load the express module
const express = require('express'); // this function returns an object of type express
const { Configuration, OpenAIApi } = require("openai");
const cors = require('cors');
const borsh = require('borsh');
const nearAPI = require("near-api-js");
const nacl = require("tweetnacl");
const sha256 = require('js-sha256');
const { NFTStorage, File } = require('nft.storage');
const { createCanvas, loadImage } = require('canvas');
const { keyStores, KeyPair } = nearAPI;

const { connect } = nearAPI;

const initNear = async (privateKey) =>{
    const keyStore = new keyStores.InMemoryKeyStore();
    // creates a public / private key pair using the provided private key
    const keyPair = KeyPair.fromString(privateKey);
    // adds the keyPair you created to keyStore
    await keyStore.setKey("testnet", "haiku_nft.cryptosketches.testnet", keyPair);
    const config = {
        networkId: "testnet",
        keyStore, 
        nodeUrl: "https://rpc.testnet.near.org",
        walletUrl: "https://wallet.testnet.near.org",
        helperUrl: "https://helper.testnet.near.org",
        explorerUrl: "https://explorer.testnet.near.org",
        contract: ""
    };      
    const near = await connect(config);
    const account = await near.account("haiku_nft.cryptosketches.testnet");
    const contract = new nearAPI.Contract(
        account, // the account object that is connecting
        "haiku_nft.cryptosketches.testnet",
        {
            // name of contract you're connecting to
            viewMethods: ["nft_token"], // view methods do not change state but usually return a value
            changeMethods: ["update_haiku"], // change methods modify state
            sender: account, // account object to initialize and sign transactions.
        }
    );
    return {near, contract};
}

let near = null;
let contract = null;

initNear(process.env.NEAR_CONTRACT_KEY)
    .then(result => {
        near=result.near;
        contract = result.contract;
    });
 
//by convention we call the object app
const app = express();

//adding a piece of middleware to allow us to parse json objects
app.use(express.json());
app.use(cors())

const configuration = new Configuration({
    apiKey: process.env.OPEN_AI_API_KEY,
  });
const openai = new OpenAIApi(configuration);

const nftstorage = new NFTStorage({
    token: process.env.NFT_STORAGE_KEY,
});

let haikus = new Map();
	
//Defining a Route
 
//app.get takes 2 arguments, the first is path/url.
//The second argument is a callback function
//the callback function takes 2 arguments: the request and response
 
app.get('/', function(_, res){  //when we get an http get request to the root/homepage
    res.send("API Version 1.0");
});

const BinArrayToJson = (binArray) => {
    var str = "";
    for (var i = 0; i < binArray.length; i++) {
        str += String.fromCharCode(parseInt(binArray[i]));
    }
    return JSON.parse(str)
}

const getHaiku = async (message) => {
    const randomSeed = Math.floor(Math.random() * Math.pow(10, Math.floor(Math.random() * 12)));
    let prompt = `${randomSeed}\nWrite a haiku`;
    if(message.adjective){
        prompt = `${randomSeed}\nWrite a ${message.adjective} haiku`;
    }
    if(message.topic){
        prompt += ` about ${message.topic}`;
    }
    console.log(prompt);
    const response = await openai.createCompletion("text-davinci-002", {
        prompt: prompt,
        temperature: 0.7,
        max_tokens: 256,
        top_p: 0,
        frequency_penalty: 1,
        presence_penalty: 1,
      });
    if (response.status != 200) {
        return None;
    }
    let haiku = response.data.choices[0].text;
    haiku = haiku.split('\n').slice(-3).join(" / ");
    return haiku;
}

const verify = async (message, signature, accountId) => {
    const validSignature = nacl.sign.detached.verify(Uint8Array.from(sha256.sha256.array(message)), Uint8Array.from(signature.signature), Uint8Array.from(signature.publicKey.data));

    signature.publicKey.data = borsh.baseEncode(signature.publicKey.data);
    let owns = true;
    try {
        await near.connection.provider.query({
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: signature.publicKey.data,
          });
    } catch (error) {
        owns=false;
    }
    
    return owns && validSignature;
}

const verifyOwnership = async (accountId, id) => {
    const token = await contract.nft_token({
        token_id: id
    });
    return token.owner_id === accountId;
}

const generateImage = async (message) => {
    const width = 1200;
    const height = 600;

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    const background = await loadImage('https://1.bp.blogspot.com/_HOCuXB2IC34/S-rpBSOfD2I/AAAAAAAAFuU/VSoSxlWmLzY/s1600/007+(www.cute-pictures.blogspot.com).jpg');
    context.drawImage(background, 0, 0);

    const text = message.haiku.replace(/\//g, '\n');

    context.font = 'bold 40pt Sans';
    context.textAlign = 'center';
    context.fillStyle = '#fff';
    context.fillText(text, 700, 170);

    const buffer = canvas.toBuffer('image/png');
    console.log(`Image generated for ${JSON.stringify(message)}.`);
    return buffer;
}

const uploadImage = async (image, message) => {
    //hash = sha256.sha256.array(image);
    const file = new File([image], `Haiku_NFT_${message.id}.png`, {type: 'image/png'});
    const result = await nftstorage.store({
        image: file,
        name: message.title,
        description: message.haiku
    });
    console.log(`Image uploaded ${JSON.stringify(message)}. ${JSON.stringify(result)}`);
    const imageUrl = result.data.image.href.replace("ipfs://", "https://ipfs.io/ipfs/");
    return imageUrl;
}

const updateNft = async (imageUrl, message) => {
    const token = await contract.update_haiku({
        token_id: message.id,
        haiku: message.haiku,
        media: imageUrl,
        title: message.title
    });
    console.log(`NFT updated ${JSON.stringify(message)}. ${JSON.stringify(token)}`);
    return token;
}
 
//when we route to /courses
app.post('/generate-ai-prompt', async (req, res, next) => {
    if(!req.body.message ||
       !req.body.signature ||
       !req.body.accountId){
        res.status(400);
        res.json({message: "Bad Request - need signedMessage in body."});
        return;
    }

    const message = BinArrayToJson(req.body.message);

    if(!message.id){
        res.status(400);
        res.json({message: `Bad Request - the message should contain the id of the empty haiku nft.`});
        return;
    }

    try {
        if(!await verify(req.body.message, req.body.signature, req.body.accountId)){
            res.status(400);
            res.json({message: "Bad Request - signed message verification failed."});
            return;
        }

        if(!await verifyOwnership(req.body.accountId, message.id)){
            res.status(400);
            res.json({message: `Bad Request - you don't own the haiku #${message.id}.`});
            return;
        }

        if(haikus.has(message.id)){
            res.status(400);
            res.json({message: `Bad Request - haiku #${message.id} already has generated prompts. Use 'get-ai-prompt' to retrieve them.`});
            return;
        }

        newHaikus = []
        for (let i = 0; i < 1; i++) {
            const haiku = await getHaiku(message);
            if(!haiku){
                res.send("Could not get a valid response from the AI.");
                return;
            }
            newHaikus.push(haiku);
        }
        haikus.set(message.id, newHaikus);

        const result = newHaikus;

        if(!result){
            res.status(400);
            res.json({message: `Bad Request - Something went wrong. Please try again`});
            haikus.delete(message.id);
            return;
        }

        res.json(result); //respond with the array of courses
    } catch (error) {
        next(error);
    }
});
 
//when we route to /courses
app.post('/get-ai-prompt', async (req, res, next) => {
    if(!req.body.message ||
       !req.body.signature ||
       !req.body.accountId){
        res.status(400);
        res.json({message: "Bad Request - need signedMessage in body."});
        return;
    }

    const message = BinArrayToJson(req.body.message);

    if(!message.id){
        res.status(400);
        res.json({message: `Bad Request - the message should contain the id of the empty haiku nft.`});
        return;
    }

    try {
        if(!await verify(req.body.message, req.body.signature, req.body.accountId)){
            res.status(400);
            res.json({message: "Bad Request - signed message verification failed."});
            return;
        }

        if(!await verifyOwnership(req.body.accountId, message.id)){
            res.status(400);
            res.json({message: `Bad Request - you don't own the haiku #${message.id}.`});
            return;
        }

        if(!haikus.has(message.id)){
            res.status(400);
            res.json({message: `Bad Request - haiku #${message.id} does not have generated prompts.`});
            return;
        }

        const result = haikus.get(message.id);

        if(!result){
            res.status(400);
            res.json({message: `Bad Request - Something went wrong. Please try again`});
            haikus.delete(message.id);
            return;
        }

        res.json(result); //respond with the array of courses
    } catch (error) {
        next(error);
    }
});

app.post('/set-haiku', async (req, res, next) => {
    if(!req.body.message ||
       !req.body.signature ||
       !req.body.accountId){
        res.status(400);
        res.json({message: "Bad Request - need signedMessage in body."});
        return;
    }

    const message = BinArrayToJson(req.body.message);

    if(!message.haiku || !message.id || !message.title){
        res.status(400);
        res.json({message: `Bad Request - the message should contain the haiku to be set.`});
        return;
    }

    try{
        if(!await verify(req.body.message, req.body.signature, req.body.accountId)){
            res.status(400);
            res.json({message: "Bad Request - signed message verification failed."});
            return;
        }
    
        if(!await verifyOwnership(req.body.accountId, message.id)){
            res.status(400);
            res.json({message: `Bad Request - you don't own the haiku #${message.id}.`});
            return;
        }

        const image = await generateImage(message);
        const imageUrl = await uploadImage(image, message);
        const updatedToken = await updateNft(imageUrl, message);
        res.json(updatedToken);
    } catch (error) {
        next(error);
    }
});

app.post('/generate-haiku-media', async (req, res, next) => {
    if(!req.body.message ||
       !req.body.signature ||
       !req.body.accountId){
        res.status(400);
        res.json({message: "Bad Request - need signedMessage in body."});
        return;
    }

    const message = BinArrayToJson(req.body.message);

    if(!message.haiku || !message.title){
        res.status(400);
        res.json({message: `Bad Request - the message should contain the haiku to be set.`});
        return;
    }

    try{
        if(!await verify(req.body.message, req.body.signature, req.body.accountId)){
            res.status(400);
            res.json({message: "Bad Request - signed message verification failed."});
            return;
        }

        const image = await generateImage(message);
        const imageUrl = await uploadImage(image, message);
        res.json({media: imageUrl});
    } catch (error) {
        next(error);
    }
});

//check if theres the environment variable PORT<br>
const port = process.env.PORT || 3000;
app.listen(port, function(){
    console.log("listening on port " + port)
})