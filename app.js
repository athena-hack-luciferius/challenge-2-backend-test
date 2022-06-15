//load the express module
const express = require('express'); // this function returns an object of type express
const { Configuration, OpenAIApi } = require("openai");
const cors = require('cors');
const borsh = require('borsh');
const nearAPI = require("near-api-js");
const nacl = require("tweetnacl");
const sha256 = require('js-sha256');
const { keyStores } = nearAPI;
const keyStore = new keyStores.InMemoryKeyStore();

const { connect } = nearAPI;

const config = {
  networkId: "testnet",
  keyStore, 
  nodeUrl: "https://rpc.testnet.near.org",
  walletUrl: "https://wallet.testnet.near.org",
  helperUrl: "https://helper.testnet.near.org",
  explorerUrl: "https://explorer.testnet.near.org",
  contract: ""
};
let near = null;

connect(config).then(n => {near=n});
 
//by convention we call the object app
const app = express();

//adding a piece of middleware to allow us to parse json objects
app.use(express.json());
app.use(cors())

const configuration = new Configuration({
    apiKey: process.env.OPEN_AI_API_KEY,
  });
const openai = new OpenAIApi(configuration);

let haikus = new Map();
	
//Defining a Route
 
//app.get takes 2 arguments, the first is path/url.
//The second argument is a callback function
//the callback function takes 2 arguments: the request and response
 
app.get('/', function(_, res){  //when we get an http get request to the root/homepage
    res.send("API Version 1.0");
});

const getHaiku = async (message) => {
    var BinArrayToJson = function(binArray)
    {
        var str = "";
        for (var i = 0; i < binArray.length; i++) {
            str += String.fromCharCode(parseInt(binArray[i]));
        }
        return JSON.parse(str)
    }

    message = BinArrayToJson(message);

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
    const response = await near.connection.provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: "haiku_nft.cryptosketches.testnet",
        method_name: "nft_token",
        args_base64: Buffer.from(JSON.stringify({token_id: id})).toString('base64'),
      });
    if(response.error){
        return false;
    }
    const token = JSON.parse(String.fromCharCode(...response.result))
    return token.owner_id === accountId;
}
 
//when we route to /courses
app.post('/get-haiku', async (req, res, next) => {
    if(!req.body.message ||
       !req.body.signature ||
       !req.body.accountId ||
       !req.body.id){
        res.status(400);
        res.json({message: "Bad Request - need signedMessage in body."});
        return;
    }
    try {
        if(!await verify(req.body.message, req.body.signature, req.body.accountId)){
            res.status(400);
            res.json({message: "Bad Request - signed message verification failed."});
            return;
        }

        if(!await verifyOwnership(req.body.accountId, req.body.id)){
            res.status(400);
            res.json({message: `Bad Request - you don't own the haiku #${req.body.id}.`});
            return;
        }

        if(!haikus.has(req.body.id)){
            newHaikus = []
            for (let i = 0; i < 1; i++) {
                const haiku = await getHaiku(req.body.message);
                if(!haiku){
                    res.send("Could not get a valid response from the AI.");
                    return;
                }
                newHaikus.push(haiku);
            }
            haikus.set(req.body.id, newHaikus);
        }

        const result = haikus.get(req.body.id);

        if(!result){
            res.status(400);
            res.json({message: `Bad Request - Something went wrong. Please try again`});
            haikus.delete(req.body.id);
            return;
        }

        res.send(result); //respond with the array of courses
    } catch (error) {
        next(error);
    }
});

//check if theres the environment variable PORT<br>
const port = process.env.PORT || 3000;
app.listen(port, function(){
    console.log("listening on port " + port)
})