<?php
namespace Tests\Unit;
use App\Support\RetryingMySqlConnector;
use PHPUnit\Framework\TestCase;
use PDOException;
class RetryingMySqlConnectorTest extends TestCase
{
    public function test_only_the_specific_transient_connect_error_is_retried(): void
    {
        $connector=new class extends RetryingMySqlConnector {
            public int $calls=0;
            protected function connectOnce(array $config) { $this->calls++; if($this->calls<3){$e=new PDOException('SQLSTATE[HY000] [2002] Operation not permitted');$e->errorInfo=['HY000',2002,'Operation not permitted'];throw $e;}return 'connected'; }
        };
        $this->assertSame('connected',$connector->connect([]));$this->assertSame(3,$connector->calls);
        $other=new class extends RetryingMySqlConnector {
            public int $calls=0;
            protected function connectOnce(array $config) { $this->calls++;$e=new PDOException('Access denied');$e->errorInfo=['HY000',1045,'Access denied'];throw $e; }
        };
        try {$other->connect([]);$this->fail('Expected an exception');} catch (PDOException $e) {$this->assertSame(1,$other->calls);}
    }
}
