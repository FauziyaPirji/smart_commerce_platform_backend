import mongoose from "mongoose";

const connectDB = async () => {
    try {
        const con = await mongoose.connect("mongodb://fauziyapirji_db_user:nP13zeoK48gnGTbe@ac-mbnuhny-shard-00-00.jrirbf7.mongodb.net:27017,ac-mbnuhny-shard-00-01.jrirbf7.mongodb.net:27017,ac-mbnuhny-shard-00-02.jrirbf7.mongodb.net:27017/?ssl=true&replicaSet=atlas-14ezid-shard-0&authSource=admin&appName=Cluster0")
        console.log(`connected successfully ${con.connection.host}`)
    } catch(error) {
        console.log(`connection error: ${error}`)
    }
}

export default connectDB;